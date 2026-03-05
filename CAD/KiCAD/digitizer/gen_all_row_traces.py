import re
import uuid

pcb_path = "digitizer.kicad_pcb"
with open(pcb_path, "r") as f:
    content = f.read()

net_name_to_id = {}
for m in re.finditer(r'\(net (\d+) "(R\d+)"\)', content):
    net_name_to_id[m.group(2)] = int(m.group(1))

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

def pad_local_pos(pin_num):
    if pin_num % 2 == 1:
        return (0, (pin_num - 1) / 2 * 2.54)
    else:
        return (2.54, (pin_num / 2 - 1) * 2.54)

# For a 2x40 header (tier "a"), row signal k (1-based) occupies pins:
#   pin_even = 4*k - 2   (right column, upper of the pair)
#   pin_odd  = 4*k - 1   (left column, lower of the pair)
# For a 2x24 header (tier "b"), same formula but k is relative (1-based within that tier)

all_segments = []

for row_num in range(2, 33):
    net_name = f"R{row_num}"
    if net_name not in net_name_to_id:
        print(f"WARNING: {net_name} not found in nets, skipping")
        continue
    net_id = net_name_to_id[net_name]

    if row_num <= 20:
        suffix = "a"
        k = row_num  # 1-based row index within tier a
    else:
        suffix = "b"
        k = row_num - 20  # 1-based row index within tier b

    pin_even = 4 * k - 2  # right column pad
    pin_odd = 4 * k - 1   # left column pad

    headers = []
    for n in range(1, 33):
        ref = f"J{n}{suffix}"
        if ref in fp_positions:
            headers.append((n, fp_positions[ref]))
    headers.sort(key=lambda h: h[1][0])

    local_left = pad_local_pos(pin_odd)
    local_right = pad_local_pos(pin_even)

    pads = []
    for n, origin in headers:
        pads.append(abs_pos(origin, local_left))
        pads.append(abs_pos(origin, local_right))

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
            f'\t\t(net {net_id})\n'
            f'\t\t(uuid "{uid}")\n'
            f'\t)'
        )
        all_segments.append(seg)

    print(f"{net_name} (net {net_id}): {suffix}-tier, pins {pin_odd}&{pin_even}, "
          f"y={pads[0][1]}/{pads[1][1]}, 63 segments")

insert_point = content.rfind("\n)")
new_content = content[:insert_point] + "\n" + "\n".join(all_segments) + content[insert_point:]

with open(pcb_path, "w") as f:
    f.write(new_content)

print(f"\nTotal: {len(all_segments)} segments for {len(all_segments)//63} row nets")
