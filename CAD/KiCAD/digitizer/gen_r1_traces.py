import re
import uuid

pcb_path = "digitizer.kicad_pcb"
with open(pcb_path, "r") as f:
    content = f.read()

fp_positions = {}
for m in re.finditer(
    r'\(footprint "Connector_PinHeader.*?"'
    r'.*?\(at ([\d.]+) ([\d.]+)\)'
    r'.*?\(property "Reference" "(J\d+[ab])"',
    content, re.DOTALL
):
    ref = m.group(3)
    fp_positions[ref] = (float(m.group(1)), float(m.group(2)))

def abs_pos(origin, local):
    return (round(origin[0] + local[0], 3), round(origin[1] + local[1], 3))

headers = []
for n in range(1, 33):
    ref = f"J{n}a"
    if ref in fp_positions:
        headers.append((n, fp_positions[ref]))
headers.sort(key=lambda h: h[1][0])

pads = []
for n, origin in headers:
    pin3_pos = abs_pos(origin, (0, 2.54))
    pin2_pos = abs_pos(origin, (2.54, 0))
    pads.append(pin3_pos)
    pads.append(pin2_pos)

NET_ID = 12  # R1

segments = []
for i in range(len(pads) - 1):
    x1, y1 = pads[i]
    x2, y2 = pads[i + 1]
    uid = str(uuid.uuid4())
    seg = (
        f'\t(segment\n'
        f'\t\t(start {x1} {y1})\n'
        f'\t\t(end {x2} {y2})\n'
        f'\t\t(width 0.25)\n'
        f'\t\t(layer "B.Cu")\n'
        f'\t\t(net {NET_ID})\n'
        f'\t\t(uuid "{uid}")\n'
        f'\t)'
    )
    segments.append(seg)

insert_point = content.rfind("\n)")
new_content = content[:insert_point] + "\n" + "\n".join(segments) + content[insert_point:]

with open(pcb_path, "w") as f:
    f.write(new_content)

print(f"Generated {len(segments)} segments for R1 net ({len(pads)} pads)")
print(f"From ({pads[0][0]}, {pads[0][1]}) to ({pads[-1][0]}, {pads[-1][1]})")
print(f"Y values alternate between {pads[0][1]} and {pads[1][1]}")
