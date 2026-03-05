import uuid

j2a_origin = (129.54, 71.882)
j2b_origin = (129.54, 173.482)

def pad_local_pos(pin_num):
    if pin_num % 2 == 1:
        x = 0
        y = (pin_num - 1) / 2 * 2.54
    else:
        x = 2.54
        y = (pin_num / 2 - 1) * 2.54
    return (x, y)

def abs_pos(origin, local):
    return (round(origin[0] + local[0], 3), round(origin[1] + local[1], 3))

c_pins_40 = [1,4,5,8,9,12,13,16,17,20,21,24,25,28,29,32,
             33,36,37,40,41,44,45,48,49,52,53,56,57,60,
             61,64,65,68,69,72,73,76,77,80]

c_pins_24 = [1,4,5,8,9,12,13,16,17,20,21,24,25,28,29,32,
             33,36,37,40,41,44,45,48]

pads = []
for pin in c_pins_40:
    pads.append(abs_pos(j2a_origin, pad_local_pos(pin)))
for pin in c_pins_24:
    pads.append(abs_pos(j2b_origin, pad_local_pos(pin)))

NET_ID = 38  # C2

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
        f'\t\t(layer "F.Cu")\n'
        f'\t\t(net {NET_ID})\n'
        f'\t\t(uuid "{uid}")\n'
        f'\t)'
    )
    segments.append(seg)

pcb_path = "digitizer.kicad_pcb"
with open(pcb_path, "r") as f:
    content = f.read()

insert_point = content.rfind("\n)")
new_content = content[:insert_point] + "\n" + "\n".join(segments) + content[insert_point:]

with open(pcb_path, "w") as f:
    f.write(new_content)

print(f"Generated {len(segments)} segments for C2 net ({len(pads)} pads)")
