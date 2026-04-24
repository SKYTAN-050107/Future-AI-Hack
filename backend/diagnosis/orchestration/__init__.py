"""Orchestration — Google ADK pipeline.

Imports are lazy so that modules without the ``google.adk`` dependency
can still be imported in lightweight test environments.
"""


def __getattr__(name: str):
    """Lazy-import orchestration modules on first access."""
    _registry = {
        "AssistantPipeline": ("orchestration.assistant_pipeline", "AssistantPipeline"),
        "LiveScanPipeline": ("orchestration.pipeline", "LiveScanPipeline"),
        "InteractionSupervisor": ("orchestration.supervisor", "InteractionSupervisor"),
    }
    if name in _registry:
        module_path, attr = _registry[name]
        import importlib
        mod = importlib.import_module(module_path)
        return getattr(mod, attr)
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")


__all__ = ["LiveScanPipeline", "AssistantPipeline", "InteractionSupervisor"]

