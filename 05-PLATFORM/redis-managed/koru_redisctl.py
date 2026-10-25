#!/usr/bin/env python3
"""KORU V8.7 local Redis controller. DEV ONLY. No third-party Python dependencies."""
import json
import os
import re
import secrets
import subprocess
import sys
import tempfile
from pathlib import Path

BASE = Path(os.environ.get("KORU_REDIS_HOME", str(Path.home() / ".local/share/koru-one/redis-managed"))).expanduser().resolve()
REG = BASE / "registry.json"
SEC = BASE / "secrets.json"
DEPTS = {"hr", "marketing", "it", "network", "advertising", "redis"}
IMAGE = "redis:8-alpine"
NET = "koru-one_app-net"


def ensure():
    BASE.mkdir(parents=True, exist_ok=True)
    os.chmod(BASE, 0o700)


def read(path):
    if not path.exists():
        return {}
    return json.loads(path.read_text())


def write(path, value):
    ensure()
    fd, name = tempfile.mkstemp(prefix=".koru-", dir=str(BASE))
    try:
        with os.fdopen(fd, "w") as f:
            os.fchmod(f.fileno(), 0o600)
            json.dump(value, f, indent=2, ensure_ascii=False)
            f.write("\n")
        os.replace(name, path)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def run(*args, check=True):
    p = subprocess.run(list(args), text=True, capture_output=True, check=False)
    if check and p.returncode:
        # Docker errors must not disclose any secret; no secret passed in command args.
        raise RuntimeError("Docker operation failed: " + p.stderr.strip()[:300])
    return p


def valid_id(ident):
    if not re.fullmatch(r"redis(?:0[1-9]|[1-9][0-9])", ident):
        raise ValueError("Node ID must be redis01..redis99")


def valid_dep(dep):
    if dep not in DEPTS:
        raise ValueError("Invalid department")


def valid_memory(value):
    mem = int(value)
    if not 32 <= mem <= 16384:
        raise ValueError("Memory must be 32..16384 MB")
    return mem


def save_acl(node, credentials):
    acl = BASE / f"{node}.acl"
    contents = ["user default off", f"user koru_admin on >{credentials['koru_admin']} ~* &* +@all"]
    for dept, password in sorted(credentials.items()):
        if dept == "koru_admin":
            continue
        valid_dep(dept)
        # No SCAN/KEYS/EVAL/CONFIG or cross-prefix access for department credentials.
        commands = "+ping +echo +hello +info +select +client|setname +client|setinfo +get +set +del +exists +ttl +pttl +type +expire +persist +hget +hset +hgetall +hdel +incr +decr +lrange +lpush +rpush +llen +xadd +xrange"
        contents.append(f"user {dept} on >{password} ~koru:{dept}:* &koru:{dept}:* {commands}")
    acl.write_text("\n".join(contents) + "\n")
    os.chmod(acl, 0o600)
    return acl


def password():
    return secrets.token_urlsafe(36)


def create(node, port, mem):
    valid_id(node)
    port = int(port)
    if port < 3001 or port > 3099:
        raise ValueError("Port must be within 3001..3099")
    mem = valid_memory(mem)
    registry = read(REG)
    all_secrets = read(SEC)
    if node in registry or node in all_secrets:
        raise ValueError("Node already managed")
    if any(int(x["port"]) == port for x in registry.values()):
        raise ValueError("Port already assigned")
    # Fail closed when another process uses the requested port.
    import socket
    with socket.socket() as sock:
        if sock.connect_ex(("127.0.0.1", port)) == 0:
            raise ValueError("Port is already in use")
    ensure()
    data_dir = BASE / f"{node}-data"
    if data_dir.exists() and any(data_dir.iterdir()):
        raise ValueError("Archived data directory exists; safely archive it before reusing this node ID")
    data_dir.mkdir(mode=0o700, exist_ok=True)
    creds = {"koru_admin": password()}
    acl = save_acl(node, creds)
    container = f"koru-v87-{node}"
    # Existing name is never adopted or silently destroyed.
    found = run("docker", "container", "inspect", container, check=False)
    if found.returncode == 0:
        raise ValueError("Docker container name already exists")
    args = ["docker", "run", "-d", "--name", container,
            "--restart", "unless-stopped", "--network", NET,
            "--user", f"{os.getuid()}:{os.getgid()}",
            "--publish", f"127.0.0.1:{port}:6379",
            "--mount", f"type=bind,src={acl},dst=/etc/redis/koru.acl,readonly",
            "--mount", f"type=bind,src={data_dir},dst=/data",
            IMAGE, "redis-server", "--aclfile", "/etc/redis/koru.acl",
            "--appendonly", "yes", "--save", "60", "1",
            "--maxmemory", f"{mem}mb", "--maxmemory-policy", "noeviction"]
    run(*args)
    registry[node] = {"port": port, "memoryMb": mem, "departments": [], "container": container}
    all_secrets[node] = creds
    write(REG, registry)
    write(SEC, all_secrets)
    return {"id": node, "port": port, "memoryMb": mem, "username": "koru_admin", "password": creds["koru_admin"]}


def assign(node, dep):
    valid_dep(dep)
    reg = read(REG)
    sec = read(SEC)
    if node not in reg:
        raise ValueError("Node not found")
    if dep in reg[node]["departments"]:
        return {"id": node, "department": dep, "alreadyAssigned": True}
    secret = password()
    sec[node][dep] = secret
    save_acl(node, sec[node])
    # Redis ACL LOAD would require a secret-bearing CLI call; restart instead.
    run("docker", "restart", reg[node]["container"])
    reg[node]["departments"].append(dep)
    write(SEC, sec)
    write(REG, reg)
    return {"id": node, "department": dep, "username": dep, "password": secret}


def unassign(node, dep):
    valid_dep(dep)
    reg, sec = read(REG), read(SEC)
    if node not in reg or dep not in reg[node]["departments"]:
        raise ValueError("Assignment not found")
    sec[node].pop(dep, None)
    save_acl(node, sec[node])
    run("docker", "restart", reg[node]["container"])
    reg[node]["departments"].remove(dep)
    write(SEC, sec)
    write(REG, reg)
    return {"id": node, "removedDepartment": dep}


def rotate(node, username):
    reg, sec = read(REG), read(SEC)
    if node not in reg or username not in sec.get(node, {}):
        raise ValueError("User or node not found")
    new = password()
    sec[node][username] = new
    save_acl(node, sec[node])
    run("docker", "restart", reg[node]["container"])
    write(SEC, sec)
    return {"id": node, "username": username, "password": new}


def launch(node, port, mem):
    acl = BASE / f"{node}.acl"
    data_dir = BASE / f"{node}-data"
    container = f"koru-v87-{node}"
    args = ["docker", "run", "-d", "--name", container,
            "--restart", "unless-stopped", "--network", NET,
            "--user", f"{os.getuid()}:{os.getgid()}",
            "--publish", f"127.0.0.1:{port}:6379",
            "--mount", f"type=bind,src={acl},dst=/etc/redis/koru.acl,readonly",
            "--mount", f"type=bind,src={data_dir},dst=/data",
            IMAGE, "redis-server", "--aclfile", "/etc/redis/koru.acl",
            "--appendonly", "yes", "--save", "60", "1",
            "--maxmemory", f"{mem}mb", "--maxmemory-policy", "noeviction"]
    run(*args)


def resize(node, memory):
    reg = read(REG)
    if node not in reg:
        raise ValueError("Node not found")
    mem = valid_memory(memory)
    prev = int(reg[node]["memoryMb"])
    if mem == prev:
        return {"id": node, "memoryMb": mem, "unchanged": True}
    # Persistent limit update: graceful stop, recreate same container name with
    # same host-mounted AOF directory. Preserve redis data and ACL secrets.
    container = reg[node]["container"]
    run("docker", "stop", "--time", "15", container)
    run("docker", "rm", container)
    try:
        launch(node, int(reg[node]["port"]), mem)
    except Exception:
        try:
            launch(node, int(reg[node]["port"]), prev)
        except Exception:
            pass
        raise
    reg[node]["memoryMb"] = mem
    write(REG, reg)
    return {"id": node, "memoryMb": mem, "previousMb": prev, "dataRetained": True}


def delete(node, confirm):
    reg, sec = read(REG), read(SEC)
    if node not in reg:
        raise ValueError("Node not found")
    if confirm != "DELETE " + node:
        raise ValueError("Explicit confirmation required")
    if reg[node]["departments"]:
        raise ValueError("Unassign departments before deleting instance")
    run("docker", "stop", "--time", "15", reg[node]["container"])
    run("docker", "rm", reg[node]["container"])
    del reg[node]
    sec.pop(node, None)
    write(REG, reg)
    write(SEC, sec)
    # AOF data is deliberately preserved for recovery; remove ACL after decommission.
    acl = BASE / f"{node}.acl"
    if acl.exists():
        acl.unlink()
    return {"deleted": node, "dataRetained": True}


def main(argv):
    if len(argv) < 2:
        raise ValueError("Usage: redisctl.py bootstrap|create|assign|unassign|rotate|delete|list")
    act = argv[1]
    if act == "bootstrap":
        result = []
        for node, port, mem, deps in [
            ("redis01", 3001, 256, ["hr", "marketing"]),
            ("redis02", 3002, 256, ["it"]),
            ("redis03", 3003, 256, ["network"]),
        ]:
            if node in read(REG):
                result.append({"id": node, "existing": True})
                continue
            entry = create(node, port, mem)
            entry["departments"] = [assign(node, d) for d in deps]
            result.append(entry)
        return result
    if act == "list":
        return read(REG)
    if act == "create" and len(argv) == 5:
        return create(argv[2], argv[3], argv[4])
    if act == "assign" and len(argv) == 4:
        return assign(argv[2], argv[3])
    if act == "unassign" and len(argv) == 4:
        return unassign(argv[2], argv[3])
    if act == "rotate" and len(argv) == 4:
        return rotate(argv[2], argv[3])
    if act == "resize" and len(argv) == 4:
        return resize(argv[2], argv[3])
    if act == "delete" and len(argv) == 4:
        return delete(argv[2], argv[3])
    raise ValueError("Invalid operation or number of parameters")


if __name__ == "__main__":
    try:
        out = main(sys.argv)
        print(json.dumps({"ok": True, "result": out}, ensure_ascii=False))
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)[:300]}, ensure_ascii=False))
        sys.exit(1)
