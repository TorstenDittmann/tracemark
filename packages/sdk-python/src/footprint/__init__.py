"""footprint: self-hosted product analytics. Server SDK for Python.

>>> from footprint import Footprint
>>> footprint = Footprint("fp_pub_…", host="https://footprint.example.com")
>>> footprint.capture("user_123", "invoice_paid", {"amount": 49})
"""

from .client import FlagsAndPayloads, Footprint, Properties
from .flags import FlagValue, InconclusiveError
from .version import VERSION

__version__ = VERSION

__all__ = [
    "Footprint",
    "FlagsAndPayloads",
    "FlagValue",
    "InconclusiveError",
    "Properties",
    "VERSION",
    "__version__",
]
