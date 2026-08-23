import sqlite3
from datetime import date

conn = sqlite3.connect('instance/bloom.db')
today = str(date.today())

rows = conn.execute("SELECT date, name FROM prayers WHERE date > ?", (today,)).fetchall()
print(f"Today: {today}")
print(f"Deleting {len(rows)} future prayer rows...")
for r in rows:
    print(f"  {r[0]} | {r[1]}")

conn.execute("DELETE FROM prayers WHERE date > ?", (today,))
conn.commit()
conn.close()
print("Done!")
