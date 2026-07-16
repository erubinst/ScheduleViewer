import re

with open('/Users/arjunarya/ReactJSProjects/ScheduleViewer/schedule-viewer/src/App.css', 'r') as f:
    lines = f.readlines()

new_lines = []
for i, line in enumerate(lines):
    if i < 892:
        new_lines.append(line)
        if i == 891:
            new_lines.append("}\n")
    elif i >= 892 and i < 931:
        new_lines.append(line[2:] if line.startswith("  ") else line)
        if i == 930:
            new_lines.append("}\n")
    elif i >= 931 and i < 1003:
        new_lines.append(line[4:] if line.startswith("    ") else (line[2:] if line.startswith("  ") else line))
    elif i >= 1003 and i < len(lines) - 2:
        new_lines.append(line[4:] if line.startswith("    ") else (line[2:] if line.startswith("  ") else line))
    
with open('/Users/arjunarya/ReactJSProjects/ScheduleViewer/schedule-viewer/src/App.css', 'w') as f:
    f.writelines(new_lines)

print("Fixed CSS file.")
