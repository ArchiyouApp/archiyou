#!/usr/bin/env python3
"""Assert the execution worker is not handed application secrets.

The worker runs user-authored scripts with no sandbox (see SECURITY.md), so it is
the container most likely to be compromised. If it can read SERVER_JWT_SECRET out
of its environment, an attacker can forge a session token for any user; the
Mailgun key would let them send mail as us.

This reads the *rendered* compose config on stdin, so it checks what Docker will
actually run rather than what the YAML appears to say:

    docker compose -f docker-compose.yml config | python3 scripts/check-worker-env.py

Exits non-zero with an explanation on failure. Run by CI (.github/workflows/ci.yml).
"""
import sys

import yaml

FORBIDDEN_SUBSTRINGS = ('JWT', 'MAILGUN', 'ADMIN_PASSWORD')


def main() -> int:
    config = yaml.safe_load(sys.stdin)
    services = config.get('services') or {}

    worker = services.get('worker')
    if worker is None:
        # The worker service ships commented out, because server-side execution is
        # off by default (SERVER_EXECUTION_AUTHORS is empty). No worker means no
        # unsandboxed script process at all, which is what this check exists to
        # contain — so this is the safest configuration, not a failure. The checks
        # below apply again the moment the service is uncommented.
        print('ok: no `worker` service — server-side execution is not deployed')
        return check_api(services)

    # env_file pulls in the whole .env, i.e. every secret, regardless of what the
    # explicit `environment:` block says.
    if 'env_file' in worker:
        print('FAIL: worker uses `env_file`, which would give it every secret in .env.')
        print('      List the variables it actually needs under `environment:` instead.')
        return 1

    env = worker.get('environment') or {}
    keys = list(env.keys()) if isinstance(env, dict) else [e.split('=', 1)[0] for e in env]

    leaked = sorted(k for k in keys if any(s in k.upper() for s in FORBIDDEN_SUBSTRINGS))
    if leaked:
        print(f'FAIL: worker environment contains secrets it does not need: {leaked}')
        print('      config.jwtSecret is a lazy getter precisely so the worker can boot without it.')
        return 1

    print(f'ok: worker environment is {sorted(keys)}')

    return check_api(services)


def check_api(services) -> int:
    """The api legitimately needs the signing key; flag the inverse mistake too."""
    api = services.get('api') or {}
    api_has_secret = 'env_file' in api or any(
        'JWT' in k.upper()
        for k in (
            (api.get('environment') or {}).keys()
            if isinstance(api.get('environment'), dict)
            else [e.split('=', 1)[0] for e in (api.get('environment') or [])]
        )
    )
    if not api_has_secret:
        print('FAIL: api has no route to SERVER_JWT_SECRET — it cannot sign tokens.')
        return 1

    print('ok: api can reach its signing secret')
    return 0


if __name__ == '__main__':
    sys.exit(main())
