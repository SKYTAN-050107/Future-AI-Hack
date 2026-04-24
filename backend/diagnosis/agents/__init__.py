"""
Google ADK agents for the live-scan pipeline.

All agents extend ``google.adk.agents.BaseAgent`` and communicate
via ``ctx.session.state`` managed by ADK's SequentialAgent runner.

Imports are lazy so that modules without the ``google.adk`` dependency
(e.g. ``chat_tool_agent``) can still be imported in test environments.
"""


def __getattr__(name: str):
    """Lazy-import agents on first access to avoid hard google.adk dependency."""
    _registry = {
        "CropEmbedAgent": ("agents.crop_embed_agent", "CropEmbedAgent"),
        "AssistantReplyAgent": ("agents.assistant_reply_agent", "AssistantReplyAgent"),
        "AgricultureAdviceAgent": ("agents.agriculture_advice_agent", "AgricultureAdviceAgent"),
        "ResponseValidationAgent": ("agents.response_validation_agent", "ResponseValidationAgent"),
        "VectorMatchAgent": ("agents.vector_match_agent", "VectorMatchAgent"),
        "ReasoningAgent": ("agents.reasoning_agent", "ReasoningAgent"),
    }
    if name in _registry:
        module_path, attr = _registry[name]
        import importlib
        mod = importlib.import_module(module_path)
        return getattr(mod, attr)
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")


__all__ = ["CropEmbedAgent", "VectorMatchAgent", "ReasoningAgent", "AssistantReplyAgent", "ResponseValidationAgent", "AgricultureAdviceAgent"]
