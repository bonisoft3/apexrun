"""Debug: side sections (planes x = const) of a mesh, zoomed, with a 0.1 m grid.
usage: section.py <mesh> <out.png> <z0> <z1> <y0> <y1> x1 x2 ..."""
import sys
import cv2, numpy as np, trimesh
m = trimesh.load(sys.argv[1], force="mesh")
z0, z1, y0, y1 = map(float, sys.argv[3:7])
xs = [float(x) for x in sys.argv[7:]]
S = int(1400 / (z1 - z0))
h = int((y1 - y0) * S) + 30
img = np.full((h * len(xs), int((z1 - z0) * S), 3), 255, np.uint8)
for i, x in enumerate(xs):
    oy = h * i + 25
    p = lambda q: (int((q[2] - z0) * S), int(oy + (y1 - q[1]) * S))
    for z in np.arange(np.ceil(z0 * 10) / 10, z1, 0.1):
        cv2.line(img, p([0, y1, z]), p([0, y0, z]), (0, 0, 255) if abs(round(z * 10) % 5) == 0 else (220, 220, 220), 1)
    for y in np.arange(np.ceil(y0 * 10) / 10, y1, 0.1):
        cv2.line(img, p([0, y, z0]), p([0, y, z1]), (0, 0, 255) if abs(round(y * 10) % 5) == 0 else (220, 220, 220), 1)
        cv2.putText(img, f"{y:.1f}", p([0, y, z0]), cv2.FONT_HERSHEY_SIMPLEX, 0.35, (0, 0, 200), 1)
    for z in np.arange(np.ceil(z0 * 2) / 2, z1, 0.5):
        cv2.putText(img, f"z{z:+.1f}", p([0, y1, z]), cv2.FONT_HERSHEY_SIMPLEX, 0.35, (0, 0, 200), 1)
    for a, b in trimesh.intersections.mesh_plane(m, [1, 0, 0], [x, 0, 0]):
        cv2.line(img, p(a), p(b), (0, 0, 0), 1, cv2.LINE_AA)
    cv2.putText(img, f"x={x:+.2f}", (5, oy - 8), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 0), 1)
cv2.imwrite(sys.argv[2], img)
