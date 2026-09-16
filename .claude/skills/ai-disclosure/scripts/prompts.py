#!/usr/bin/env python3
"""Print the user's prompts of a Claude Code session, for an AI disclosure record.

    python3 prompts.py <session-id-or-jsonl-path> [--since 2026-09-14T00:00]

The session id is the folder name of the session's scratchpad directory. Transcripts live in
~/.claude/projects/<cwd with / replaced by ->/<session-id>.jsonl. Output: one line per prompt,
local time with UTC offset, then the prompt text; multi-line prompts are indented.
"""
import json, os, sys
from datetime import datetime

def transcript_path(arg):
    if arg.endswith('.jsonl'):
        return arg
    slug = os.getcwd().replace('/', '-')
    return os.path.expanduser(f'~/.claude/projects/{slug}/{arg}.jsonl')

def prompts(path, since=None):
    for line in open(path, encoding='utf-8', errors='ignore'):
        try:
            entry = json.loads(line)
        except json.JSONDecodeError:
            continue
        if entry.get('type') != 'user':
            continue
        content = entry.get('message', {}).get('content')
        if isinstance(content, list):
            content = '\n'.join(b.get('text', '') for b in content if isinstance(b, dict) and b.get('type') == 'text')
        if not isinstance(content, str) or not content.strip() or content.lstrip().startswith('<'):
            continue  # tool results and system-injected messages are not prompts
        stamp = entry.get('timestamp', '')
        if since and stamp < since:
            continue
        when = datetime.fromisoformat(stamp.replace('Z', '+00:00')).astimezone().strftime('%Y-%m-%d %H:%M %z')
        yield when, content.strip()

if __name__ == '__main__':
    argv = sys.argv[1:]
    if not argv or argv[0] in ('-h', '--help'):
        print(__doc__); sys.exit(0)
    since = argv[argv.index('--since') + 1] if '--since' in argv else None
    path = transcript_path(argv[0])
    if not os.path.exists(path):
        sys.exit(f'no transcript at {path}')
    for when, text in prompts(path, since):
        first, *rest = text.split('\n')
        print(f'{when}  {first}')
        for line in rest:
            print(f'{" " * 24}{line}')
