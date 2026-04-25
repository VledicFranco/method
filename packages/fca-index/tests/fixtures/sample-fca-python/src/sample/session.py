"""Default session implementation for the sample component."""


class Session:
    """A trivial session value object."""

    def __init__(self, sid: str) -> None:
        self.sid = sid


def open_session(sid: str) -> Session:
    return Session(sid)
