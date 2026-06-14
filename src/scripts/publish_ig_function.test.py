import ast
import unittest
from pathlib import Path


class PublishIgFunctionStructureTest(unittest.TestCase):
    def test_instagrapi_is_not_imported_at_module_load_time(self):
        module = ast.parse(
            Path("api/publish_ig.py").read_text(encoding="utf-8"),
            filename="api/publish_ig.py",
        )

        top_level_imports = [
            node
            for node in module.body
            if isinstance(node, (ast.Import, ast.ImportFrom))
        ]

        imported_modules = []
        for node in top_level_imports:
            if isinstance(node, ast.ImportFrom):
                imported_modules.append(node.module)
            else:
                imported_modules.extend(alias.name for alias in node.names)

        self.assertNotIn("instagrapi", imported_modules)


if __name__ == "__main__":
    unittest.main()
