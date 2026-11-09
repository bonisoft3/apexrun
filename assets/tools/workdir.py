"""Where the tools keep what they fetch, train and bake: tools/work, or
APEXRUN_TOOLS_WORK on a runner whose checkout other jobs clean."""
import os

WORK = os.environ.get("APEXRUN_TOOLS_WORK") or os.path.join(os.path.dirname(os.path.abspath(__file__)), "work")
