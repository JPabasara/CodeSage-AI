"""Shared base for every request and response shape.

Field names go out exactly as they are written here — snake_case, matching
docs/api/openapi.yaml, the SRS and the database columns. One spelling everywhere
means nobody has to remember which side of the wire they are on.

`extra="forbid"` makes an unexpected field an error rather than something quietly
ignored, so a client sending `trust_slider` when the field is `trust_s` finds out
immediately instead of wondering why the value never changes.
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict


class ApiModel(BaseModel):
    model_config = ConfigDict(
        from_attributes=True,
        extra="forbid",
    )
