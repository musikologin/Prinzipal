"""Baut public/index.html aus src/app.html (derselbe App-Code wie im Claude-Artifact) plus Zwischenschicht."""
import pathlib
root = pathlib.Path(__file__).parent
app = (root / "src/app.html").read_text(encoding="utf8")
shim = (root / "src/shim-head.html").read_text(encoding="utf8")
anchor = '<meta charset="utf-8">'
assert app.count(anchor) == 1, "Anker fehlt"
out = app.replace(anchor, anchor + "\n" + shim, 1)
(root / "public/index.html").write_text(out, encoding="utf8")
print("public/index.html", len(out), "Zeichen")
