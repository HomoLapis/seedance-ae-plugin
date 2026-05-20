# Security Policy

## Where your data goes

- **API keys** entered in the Settings panel are stored in CEP's
  `localStorage`, keyed under `seedance_ark_key`, `seedance_zai_key`,
  `seedance_fal_key`, `seedance_alibaba_key`. They live on disk inside
  the CEP runtime's per-user profile and are sent only to the documented
  vendor endpoints.
- **History, output paths, lifetime spend** are stored locally, same
  place, under `seedance_history`, `seedance_output_dir`, `seedance_total_spent`.
- **No telemetry, no analytics, no crash reporting**. This project has
  no backend.

## Vendor endpoints we talk to

| Endpoint                                              | Purpose                  |
|-------------------------------------------------------|--------------------------|
| `https://ark.ap-southeast.bytepluses.com/api/v3`      | BytePlus ARK (Seedance)  |
| `https://api.z.ai/api/paas/v4/chat/completions`       | Z.AI prompt assistant    |
| `https://queue.fal.run/*`                             | FAL (optional models)    |
| `https://dashscope*.aliyuncs.com`                     | Alibaba Dashscope        |
| `https://tmpfiles.org/api/v1/upload`                  | Reference-image hosting  |

The last one (`tmpfiles.org`) is used to pass references to vendor APIs
that only accept URLs. Uploaded files auto-expire on tmpfiles' side. If
your security posture forbids this, disable image references or fork to
use your own bucket.

## Reporting vulnerabilities

If you find a security issue, exfiltration vector, key leak, anything
that puts users at risk: please **do not open a public GitHub issue**.

Email `info@homolapis.ai` with:
- A description of the issue.
- A reproduction (steps, payload, screenshots).
- Whether you'd like to be credited in the fix.

We'll do our best to acknowledge quickly and ship a fix as fast as the
issue warrants. This is a small project, no formal SLA, but security
reports jump the queue.
