import re

pcb_path = "digitizer.kicad_pcb"
with open(pcb_path, "r") as f:
    content = f.read()

pattern = re.compile(
    r'(\(property "Value" "Conn_02x(?:40|24)_Odd_Even"\s*'
    r'\(at [^)]+\)\s*'
    r'\(layer "F\.Fab"\)\s*)'
    r'(?!\(hide yes\))'
)

new_content, count = pattern.subn(r'\1(hide yes)\n\t\t\t', content)

with open(pcb_path, "w") as f:
    f.write(new_content)

print(f"Added (hide yes) to {count} Value fields")
