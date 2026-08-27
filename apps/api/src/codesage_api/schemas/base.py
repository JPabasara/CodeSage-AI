"""Shared base for every request and response shape. """


from __future__ import annotations
from pydantic import BaseModel, ConfigDict


class ApiModel(BaseModel):
    model_config = ConfigDict(
        from_attributes=True,
        extra="forbid",  # to reject if there is any extra attributes
    )
