import re
import uuid

pcb_path = "digitizer.kicad_pcb"
with open(pcb_path, "r") as f:
    content = f.read()

net_name_to_id = {}
for m in re.finditer(r'\(net (\d+) "(C\d+)"\)', content):
    net_name_to_id[m.group(2)] = int(m.group(1))

footprint_re = re.compile(
    r'\(footprint "Connector_PinHeader.*?"'
    r'.*?\(at ([\d.]+) ([\d.]+)\)'
    r'.*?\(property "Reference" "(J\d+[ab])"',
    re.DOTALL
)

fp_positions = {}
for m in footprint_re.finditer(content):
    x, y = float(m.group(1)), float(m.group(2))
    ref = m.group(3)
    fp_positions[ref] = (x, y)

fp_col_net = {}
for m in re.finditer(
    r'\(property "Reference" "(J\d+[ab])".*?\(pad "1" thru_hole rect.*?\(net (\d+) "(C\d+)"\)',
    content, re.DOTALL
):
    ref = m.group(1)
    net_name = m.group(3)
    fp_col_net[ref] = net_name

def pad_local_pos(pin_num):
    if pin_num % 2 == 1:
        return (0, (pin_num - 1) / 2 * 2.54)
    else:
        return (2.54, (pin_num / 2 - 1) * 2.54)

def abs_pos(origin, local):
    return (round(origin[0] + local[0], 3), round(origin[1] + local[1], 3))

c_pins_40 = [1,4,5,8,9,12,13,16,17,20,21,24,25,28,29,32,
             33,36,37,40,41,44,45,48,49,52,53,56,57,60,
             61,64,65,68,69,72,73,76,77,80]

c_pins_24 = [1,4,5,8,9,12,13,16,17,20,21,24,25,28,29,32,
             33,36,37,40,41,44,45,48]

skip_nets = {"C1", "C2"}

all_segments = []
for n in range(1, 33):
    ref_a = f"J{n}a"
    ref_b = f"J{n}b"
    if ref_a not in fp_positions or ref_b not in fp_positions:
        print(f"WARNING: {ref_a} or {ref_b} not found, skipping")
        continue
    if ref_a not in fp_col_net:
        print(f"WARNING: could not determine column net for {ref_a}, skipping")
        continue

    col_net_name = fp_col_net[ref_a]
    if col_net_name in skip_nets:
        continue

    net_id = net_name_to_id[col_net_name]
    origin_a = fp_positions[ref_a]
    origin_b = fp_positions[ref_b]

    pads = []
    for pin in c_pins_40:
        pads.append(abs_pos(origin_a, pad_local_pos(pin)))
    for pin in c_pins_24:
        pads.append(abs_pos(origin_b, pad_local_pos(pin)))

    for i in range(len(pads) - 1):
        x1, y1 = pads[i]
        x2, y2 = pads[i + 1]
        uid = str(uuid.uuid4())
        seg = (
            f'\t(segment\n'
            f'\t\t(start {x1} {y1})\n'
            f'\t\t(end {x2} {y2})\n'
            f'\t\t(width 0.25)\n'
            f'\t\t(layer "F.Cu")\n'
            f'\t\t(net {net_id})\n'
            f'\t\t(uuid "{uid}")\n'
            f'\t)'
        )
        all_segments.append(seg)

    print(f"{col_net_name} (net {net_id}): {ref_a} @ {origin_a} + {ref_b} @ {origin_b} -> 63 segments")

insert_point = content.rfind("\n)")
new_content = content[:insert_point] + "\n" + "\n".join(all_segments) + content[insert_point:]

with open(pcb_path, "w") as f:
    f.write(new_content)

print(f"\nTotal: {len(all_segments)} segments generated for {len(all_segments)//63} column nets")
