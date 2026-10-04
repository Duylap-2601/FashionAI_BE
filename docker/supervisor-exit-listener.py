#!/usr/bin/env python3
import os
import signal
import sys

from supervisor import childutils


def main() -> None:
    while True:
        headers, payload = childutils.listener.wait(sys.stdin, sys.stdout)
        process_name = headers.get("processname", "unknown")
        event_name = headers.get("eventname", "unknown")
        payload_text = payload.decode("utf-8", errors="replace") if isinstance(payload, bytes) else payload

        print(
            f"[supervisor-exit-listener] {process_name} emitted {event_name}: {payload_text}",
            file=sys.stderr,
            flush=True,
        )

        pid_file = "/tmp/supervisord.pid"
        try:
            with open(pid_file, "r", encoding="utf-8") as file:
                supervisord_pid = int(file.read().strip())
            os.kill(supervisord_pid, signal.SIGTERM)
        except Exception as exc:  # noqa: BLE001 - best-effort shutdown hook
            print(
                f"[supervisor-exit-listener] failed to signal supervisord: {exc}",
                file=sys.stderr,
                flush=True,
            )

        childutils.listener.ok(sys.stdout)


if __name__ == "__main__":
    main()
