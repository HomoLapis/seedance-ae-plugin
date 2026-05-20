/**
 * Convert a WAV file (ArrayBuffer or Uint8Array) to an MP3 Blob.
 *
 * Background: After Effects' native render queue does NOT export MP3
 * (Adobe removed MP3 from the render queue years ago — it's only available
 * via Adobe Media Encoder). The BytePlus Seedance r2v endpoint accepts MP3
 * but rejects the AIFF/WAV-PCM formats that AE produces. So we render WAV
 * from AE's render queue, then transcode WAV → MP3 client-side.
 *
 * Uses the Web Audio API to decode the WAV (handles 16/24/32-bit PCM and
 * float PCM via the browser's built-in decoder), then lamejs to encode MP3.
 */
import lamejs from "@breezystack/lamejs";

/**
 * Decode a WAV ArrayBuffer to an AudioBuffer using the Web Audio API.
 * Throws if the format isn't decodable (e.g. AIFF on Chromium).
 */
async function decodeAudio(arrayBuffer) {
  // Chromium's decodeAudioData does NOT support AIFF — After Effects' WAV
  // template is not always present, and when it falls back to AIFF the decode
  // fails. Detect AIFF by magic bytes and use the pure-JS parser instead.
  const hdr = new Uint8Array(arrayBuffer, 0, Math.min(12, arrayBuffer.byteLength));
  const isAiff = hdr[0] === 0x46 && hdr[1] === 0x4F && hdr[2] === 0x52 && hdr[3] === 0x4D && // FORM
                 (hdr[8] === 0x41 && hdr[9] === 0x49 && hdr[10] === 0x46 && (hdr[11] === 0x46 || hdr[11] === 0x43)); // AIFF or AIFC
  if (isAiff) {
    return decodeAiff(arrayBuffer);
  }

  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) throw new Error("Web Audio API not available in this environment.");
  const ctx = new AC();
  try {
    const buf = arrayBuffer.slice(0);
    const audioBuf = await ctx.decodeAudioData(buf);
    return audioBuf;
  } finally {
    try { await ctx.close(); } catch (_) {}
  }
}

/**
 * Parse IEEE 754 80-bit extended precision (big-endian) from the COMM chunk.
 * Used by AIFF to store sample rate (typically 44100 or 48000).
 */
function readExtendedFloat80(view, offset) {
  const sign   = (view.getUint8(offset) & 0x80) ? -1 : 1;
  const exp    = ((view.getUint8(offset) & 0x7F) << 8) | view.getUint8(offset + 1);
  const hiMant = (view.getUint8(offset + 2) << 24) | (view.getUint8(offset + 3) << 16) |
                 (view.getUint8(offset + 4) <<  8) |  view.getUint8(offset + 5);
  const loMant = (view.getUint8(offset + 6) << 24) | (view.getUint8(offset + 7) << 16) |
                 (view.getUint8(offset + 8) <<  8) |  view.getUint8(offset + 9);
  if (exp === 0 && hiMant === 0 && loMant === 0) return 0;
  if (exp === 0x7FFF) return sign * Infinity;
  const realExp = exp - 16383;
  // Mantissa is 64-bit unsigned; convert via two 32-bit halves.
  const mantissa = (hiMant >>> 0) * Math.pow(2, 32) + (loMant >>> 0);
  return sign * mantissa * Math.pow(2, realExp - 63);
}

/**
 * Pure-JS AIFF/AIFF-C decoder. Supports 16/24/32-bit PCM (big-endian),
 * which is what AE's "AIFF 48kHz" and "AIFF" templates produce.
 *
 * Returns an AudioBuffer-shaped object compatible with encodeMp3().
 */
function decodeAiff(arrayBuffer) {
  const view = new DataView(arrayBuffer);
  // FORM <size> AIFF/AIFC
  if (view.getUint32(0) !== 0x464F524D) throw new Error("Not an AIFF file (missing FORM)");
  const formType = view.getUint32(8);
  const isAifc = formType === 0x41494643; // "AIFC"
  if (!isAifc && formType !== 0x41494646)  // "AIFF"
    throw new Error("Not an AIFF/AIFC file");

  let channels = 0, numFrames = 0, bitsPerSample = 0, sampleRate = 0;
  let ssndOffset = 0, ssndSize = 0;
  let compressionType = "NONE";

  let p = 12;
  while (p + 8 <= arrayBuffer.byteLength) {
    const id   = view.getUint32(p);
    const size = view.getUint32(p + 4);
    const dataStart = p + 8;
    if (id === 0x434F4D4D) { // "COMM"
      channels      = view.getInt16(dataStart);
      numFrames     = view.getUint32(dataStart + 2);
      bitsPerSample = view.getInt16(dataStart + 6);
      sampleRate    = readExtendedFloat80(view, dataStart + 8);
      if (isAifc && size >= 22) {
        const ct0 = view.getUint8(dataStart + 18);
        const ct1 = view.getUint8(dataStart + 19);
        const ct2 = view.getUint8(dataStart + 20);
        const ct3 = view.getUint8(dataStart + 21);
        compressionType = String.fromCharCode(ct0, ct1, ct2, ct3);
      }
    } else if (id === 0x53534E44) { // "SSND"
      const offset    = view.getUint32(dataStart);
      // const blockSize = view.getUint32(dataStart + 4);
      ssndOffset = dataStart + 8 + offset;
      ssndSize   = size - 8 - offset;
    }
    // Chunks are padded to even byte boundaries
    p = dataStart + size + (size & 1);
  }

  if (!ssndOffset || !channels || !sampleRate || !bitsPerSample)
    throw new Error("AIFF missing required COMM/SSND chunks");

  // AE usually writes uncompressed PCM. Reject compressed AIFC variants.
  const ctTrim = compressionType.replace(/\0/g, "").toUpperCase();
  if (isAifc && ctTrim && ctTrim !== "NONE" && ctTrim !== "SOWT" && ctTrim !== "TWOS") {
    throw new Error(`AIFC compression "${ctTrim}" not supported. Enable an uncompressed AIFF/WAV template in After Effects.`);
  }
  const littleEndian = ctTrim === "SOWT"; // Apple's little-endian AIFC variant

  // Decode samples into Float32Array per channel
  const bytesPerSample = bitsPerSample >> 3;
  const frameBytes = bytesPerSample * channels;
  const channelData = [];
  for (let c = 0; c < channels; c++) channelData.push(new Float32Array(numFrames));

  const dv = view;
  const base = ssndOffset;
  const maxFrames = Math.min(numFrames, Math.floor(ssndSize / frameBytes));

  for (let i = 0; i < maxFrames; i++) {
    for (let c = 0; c < channels; c++) {
      const off = base + i * frameBytes + c * bytesPerSample;
      let sample = 0;
      if (bitsPerSample === 16) {
        sample = littleEndian ? dv.getInt16(off, true) : dv.getInt16(off, false);
        channelData[c][i] = sample / 0x8000;
      } else if (bitsPerSample === 24) {
        // 24-bit PCM big-endian (standard AIFF)
        const b0 = dv.getUint8(off), b1 = dv.getUint8(off + 1), b2 = dv.getUint8(off + 2);
        const u = littleEndian
          ? (b2 << 16) | (b1 << 8) | b0
          : (b0 << 16) | (b1 << 8) | b2;
        sample = (u & 0x800000) ? u - 0x1000000 : u;
        channelData[c][i] = sample / 0x800000;
      } else if (bitsPerSample === 32) {
        sample = littleEndian ? dv.getInt32(off, true) : dv.getInt32(off, false);
        channelData[c][i] = sample / 0x80000000;
      } else if (bitsPerSample === 8) {
        // AIFF 8-bit is SIGNED (unlike WAV's unsigned 8-bit)
        sample = dv.getInt8(off);
        channelData[c][i] = sample / 0x80;
      } else {
        throw new Error(`Unsupported AIFF bit depth: ${bitsPerSample}`);
      }
    }
  }

  return {
    numberOfChannels: channels,
    sampleRate:       Math.round(sampleRate),
    length:           maxFrames,
    getChannelData:   (c) => channelData[c],
  };
}

/**
 * Convert a Float32 channel buffer (-1..1) to an Int16 PCM buffer.
 */
function floatTo16BitPCM(float32) {
  const out = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    let s = Math.max(-1, Math.min(1, float32[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

/**
 * Encode an AudioBuffer to MP3 bytes (Uint8Array) using lamejs.
 *
 * @param {AudioBuffer} audioBuf
 * @param {number} kbps - bitrate (default 128)
 */
function encodeMp3(audioBuf, kbps = 128) {
  const channels = Math.min(audioBuf.numberOfChannels, 2); // lamejs supports mono/stereo
  const sampleRate = audioBuf.sampleRate;
  const encoder = new lamejs.Mp3Encoder(channels, sampleRate, kbps);

  const left  = floatTo16BitPCM(audioBuf.getChannelData(0));
  const right = channels === 2 ? floatTo16BitPCM(audioBuf.getChannelData(1)) : null;

  const blockSize = 1152; // standard MP3 frame size
  const chunks = [];

  for (let i = 0; i < left.length; i += blockSize) {
    const leftChunk  = left.subarray(i, i + blockSize);
    const rightChunk = right ? right.subarray(i, i + blockSize) : null;
    const mp3Buf = right
      ? encoder.encodeBuffer(leftChunk, rightChunk)
      : encoder.encodeBuffer(leftChunk);
    if (mp3Buf.length > 0) chunks.push(mp3Buf);
  }
  const tail = encoder.flush();
  if (tail.length > 0) chunks.push(tail);

  // Concatenate all Uint8Array chunks
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
}

/**
 * Convert WAV bytes to an MP3 File object suitable for upload.
 *
 * @param {ArrayBuffer|Uint8Array} wavBytes
 * @param {string} fileName - desired output name (extension will be forced to .mp3)
 * @param {number} kbps     - MP3 bitrate (default 128)
 * @returns {Promise<File>}
 */
export async function wavBytesToMp3File(wavBytes, fileName = "audio.mp3", kbps = 128) {
  const buf = wavBytes instanceof ArrayBuffer
    ? wavBytes
    : wavBytes.buffer.slice(wavBytes.byteOffset, wavBytes.byteOffset + wavBytes.byteLength);

  const audioBuf = await decodeAudio(buf);
  const mp3Bytes = encodeMp3(audioBuf, kbps);

  const baseName = fileName.replace(/\.[^.]+$/, "") + ".mp3";
  return new File([mp3Bytes], baseName, { type: "audio/mpeg" });
}
