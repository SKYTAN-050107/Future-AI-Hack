"""
Pipeline agent base class — provided by Google ADK.

All pipeline agents now extend ``google.adk.agents.BaseAgent`` directly.

ADK BaseAgent is a Pydantic model with the following contract:

- Declare ``name`` (str) and ``description`` (str) as constructor fields.
- Override ``_run_async_impl(ctx: InvocationContext)`` for async logic.
- Read / write shared pipeline state via ``ctx.session.state``
  (this replaces the old ``context`` dict).
- Yield at least one ``Event`` to signal step completion.
- Store service instances as Pydantic ``PrivateAttr``.

This module re-exports ADK's BaseAgent so the rest of the codebase can
continue importing from ``agents.base_agent`` without disruption.
"""

from google.adk.agents import BaseAgent  # noqa: F401

__all__ = ["BaseAgent"]
