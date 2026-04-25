"""Verification — pytest cases for Session."""
from .session import open_session


def test_open_returns_session():
    s = open_session("s1")
    assert s.sid == "s1"
