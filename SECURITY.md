# Security policy

## Local-use boundary

Pathways Local is a single-user desktop service with automatic owner access. It
has no passwords or remote-user authentication. Anyone or any local program that
can reach the service can access its workspace. Do not expose it to a LAN, public
internet, tunnel, or untrusted proxy. Keep the Compose loopback port binding.

The API checks the actual Host header, Origin, and fetch metadata. Writes also
require a custom client header and JSON content. These checks reduce browser
cross-site and DNS-rebinding risks; they are not authentication for local programs.
The server validates task data and uses atomic SQLite revision checks.

Do not commit workspace exports, database files, backups, or local environment
files. The default data directories are ignored by Git and Docker. Use synthetic
data in tests and issue reports. There are no Google credentials to configure.

## Reporting

Use [private vulnerability reporting](https://github.com/hooman8/pathways-local/security/advisories/new)
for security issues. If that channel is unavailable, open a minimal issue requesting
a private contact without disclosing the vulnerability. Include reproduction steps
using synthetic data, the affected commit, expected behavior, and impact privately.

Security fixes target `main`. There is no guaranteed response time or separate
long-term support branch. Users are responsible for applying updates and keeping
independent backups of their local workspace.
