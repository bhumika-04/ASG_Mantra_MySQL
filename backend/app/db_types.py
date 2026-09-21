"""GUID column type — stores a Python uuid.UUID as a 36-character string.

MySQL has no native UUID column type, so User IDs and other GUID foreign keys
are stored as CHAR(36). This wrapper just gives clean uuid.UUID <-> str
conversion on bind/result instead of every model handling it inline.
"""
import uuid

from sqlalchemy.types import CHAR, TypeDecorator


class GUID(TypeDecorator):
    impl = CHAR(36)
    cache_ok = True

    def process_bind_param(self, value, dialect):
        if value is None:
            return value
        if not isinstance(value, uuid.UUID):
            value = uuid.UUID(str(value))
        return str(value)

    def process_result_value(self, value, dialect):
        if value is None:
            return value
        return str(value)
