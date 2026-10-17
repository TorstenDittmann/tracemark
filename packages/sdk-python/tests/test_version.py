"""The version in the code matches pyproject.toml."""

from __future__ import annotations

import re
import unittest

from _support import PACKAGE

import tracemark


class VersionTest(unittest.TestCase):
    def test_matches_pyproject(self) -> None:
        text = (PACKAGE / "pyproject.toml").read_text(encoding="utf-8")
        match = re.search(r'^version = "([^"]+)"', text, re.M)
        assert match is not None
        self.assertEqual(tracemark.VERSION, match.group(1))
        self.assertEqual(tracemark.__version__, match.group(1))


if __name__ == "__main__":
    unittest.main()
