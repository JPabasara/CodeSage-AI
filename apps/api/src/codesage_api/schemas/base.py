"""Shared Pydantic base for the final SRS/SAD REST contract.

The documents are authoritative. Existing web types supply camelCase field names
only where the documents leave the JSON naming unspecified.
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel


class CamelModel(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        from_attributes=True,
        extra="forbid",
    )
