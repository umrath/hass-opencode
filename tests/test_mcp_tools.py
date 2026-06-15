"""Structural coverage for the MCP server's tool dispatch.

index.js advertises tools in a list (each entry has `name:` + `inputSchema:`)
and dispatches them in a `switch (name)` with `case "<name>":`. A tool that is
advertised but has no matching case crashes at call time ("Unknown tool"). The
server starts on import (stdio), so it cannot be imported in a unit test; this
checks the contract statically against the (consistent) source style instead.
"""
import re
import unittest
from pathlib import Path

INDEX = (Path(__file__).resolve().parents[1]
         / "ha_opencode" / "rootfs" / "opt" / "ha-mcp-server" / "index.js")


class TestMcpToolHandlers(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.text = INDEX.read_text() if INDEX.exists() else ""
        cls.lines = cls.text.splitlines()

    def declared_tools(self):
        """A tool definition is a `name: "x"` immediately followed (within a few
        lines) by an `inputSchema:` — this excludes resources/prompts, which use
        `uri:`/no inputSchema."""
        tools = set()
        for i, line in enumerate(self.lines):
            m = re.search(r'name:\s*"([a-z][a-z0-9_]*)"\s*,', line)
            if m and any("inputSchema" in l for l in self.lines[i + 1:i + 5]):
                tools.add(m.group(1))
        return tools

    def handler_cases(self):
        return set(re.findall(r'case\s+"([a-z][a-z0-9_]*)"\s*:', self.text))

    def test_index_exists(self):
        self.assertTrue(INDEX.exists(), f"{INDEX} must exist")

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
