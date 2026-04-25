"""SessionPort — protocol for session lifecycle."""
from typing import Protocol


class SessionPort(Protocol):
    def open(self, sid: str) -> object: ...
