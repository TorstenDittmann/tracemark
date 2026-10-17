"""tracemark: self-hosted product analytics. Server SDK for Python.

>>> from tracemark import Tracemark
>>> tracemark = Tracemark("fp_pub_…", host="https://tracemark.example.com")
>>> tracemark.capture("user_123", "invoice_paid", {"amount": 49})
"""

from .client import FlagsAndPayloads, Tracemark, Properties
from .flags import FlagValue, InconclusiveError
from .version import VERSION

__version__ = VERSION

__all__ = [
    "Tracemark",
    "FlagsAndPayloads",
    "FlagValue",
    "InconclusiveError",
    "Properties",
    "VERSION",
    "__version__",
]
