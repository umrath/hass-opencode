"""Structural coverage for the MCP server's tool dispatch.

Tools are defined in lib/tools.js; handlers are dispatched via a switch in
index.js. A tool that is advertised but has no matching case crashes at call
time ("Unknown tool"). This checks the contract statically.
"""
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
INDEX = ROOT / "ha_opencode" / "rootfs" / "opt" / "ha-mcp-server" / "index.js"
TOOLS_MODULE = ROOT / "ha_opencode" / "rootfs" / "opt" / "ha-mcp-server" / "lib" / "tools.js"

# Files that declare MCP tools (name: "..." + inputSchema)
TOOL_SOURCES = [
    INDEX,
    TOOLS_MODULE,
]


class TestMcpToolHandlers(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.index_text = INDEX.read_text() if INDEX.exists() else ""
        cls.tools_text = "".join(
            p.read_text() if p.exists() else "" for p in TOOL_SOURCES
        )
        cls.tools_lines = cls.tools_text.splitlines()

    def declared_tools(self):
        """A tool definition is a `name: "x"` immediately followed (within a few
        lines) by an `inputSchema:` — this excludes resources/prompts, which use
        `uri:`/no inputSchema."""
        tools = set()
        for i, line in enumerate(self.tools_lines):
            m = re.search(r'name:\s*"([a-z][a-z0-9_]*)"\s*,', line)
            if m and any("inputSchema" in l for l in self.tools_lines[i + 1:i + 5]):
                tools.add(m.group(1))
        return tools

    def handler_cases(self):
        return set(re.findall(r'case\s+"([a-z][a-z0-9_]*)"\s*:', self.index_text))

    def test_index_exists(self):
        self.assertTrue(INDEX.exists(), f"{INDEX} must exist")

    def test_tools_module_exists(self):
        self.assertTrue(TOOLS_MODULE.exists(), f"{TOOLS_MODULE} must exist")

    def test_tools_are_declared(self):
        self.assertGreater(len(self.declared_tools()), 10,
                           "expected the MCP server to declare many tools")

    def test_every_declared_tool_has_a_handler(self):
        missing = sorted(self.declared_tools() - self.handler_cases())
        self.assertEqual(missing, [],
                         f"Tools advertised in the list but with no `case` handler "
                         f"(would crash at call time): {missing}")


if __name__ == "__main__":
    unittest.main()
