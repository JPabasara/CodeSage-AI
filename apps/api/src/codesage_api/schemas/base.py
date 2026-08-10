"""Shared Pydantic base.

The data contract is TypeScript-first, so the wire is camelCase while the Python
stays snake_case. Doing that conversion here — once — rather than with per-field
aliases keeps the schema files readable and makes it impossible for one field to
be forgotten.
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel


class CamelModel(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        from_attributes=True,
    )
