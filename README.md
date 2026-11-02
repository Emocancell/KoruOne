# KORU ONE

**Enterprise Operations & Redis Control Platform**

KORU ONE, kurumsal departman operasyonlarını Redis odaklı veri erişimi ve merkezi Redis yönetimiyle birleştirmeyi hedefleyen, modüler bir platform projesidir.

> **Proje durumu:** Mimari ve ilk kurulum aşaması. Aşağıdaki yetenekler hedef kapsamı tanımlar; henüz tamamlandıkları anlamına gelmez. Geliştirme verileri sentetiktir.

## 1. Hedefler

- Departmana ve kullanıcı rolüne göre özelleşen portal ve dashboard'lar.
- Network, İK, IT Service Desk, Marketing ve reklam yönetimi modülleri.
- Redis cache HIT/MISS, TTL, gecikme, bellek ve Redis–PostgreSQL karşılaştırma metrikleri.
- Redis envanteri, sağlık izleme, ACL ve onaylı node bakım iş akışları.
- Denetlenebilir yetkilendirme, değişiklik geçmişi ve Excel/CSV raporları.

## 2. Teknoloji kararı

| Katman | Teknoloji | Sorumluluk |
| --- | --- | --- |
| Web | Next.js, React, TypeScript | Portal, yönetim ekranları, grafikler |
| İş API'si | .NET 10 | İş kuralları, veri işlemleri, yetkilendirme |
| Redis kontrol API'si | Ayrı .NET 10 servisi | Node envanteri ve yetkili operasyonlar |
| Kalıcı veri | PostgreSQL 17 | İş kayıtlarının doğruluk kaynağı |
| Hızlı veri | Redis 8 | Cache, sayaçlar ve dashboard projeksiyonları |
| Olay akışı | Redis Streams | Asenkron olay tüketimi |
| Kimlik | Keycloak / OIDC | Giriş, roller; ileride AD/LDAP entegrasyonu |
| Gözlemlenebilirlik | OpenTelemetry, Prometheus/Grafana | Uygulama ve Redis metrikleri |
| Dağıtım | Docker Compose; hedefte OpenShift | Lokal geliştirme ve kurumsal ortam |

## 3. Mimari

```text
Browser
  |
  v
Web Portal (Next.js)
  |
  +--> Business API (.NET) ------> PostgreSQL (kalıcı kayıtlar)
  |         |
  |         +--------------------> Redis Cache / Streams
  |
  +--> Redis Control API (.NET) -> Envanter / Onay / Audit
            |
            +--> Yetkili node ajanları / Redis topolojileri

Identity: Keycloak / OIDC
Security: API authorization + Redis ACL + TLS + network policy
Observability: Redis exporter + OpenTelemetry + metrik/log panelleri
```

**Veri bütünlüğü:** Maaş, ürün fiyatı, ticket ve kullanıcı yetkileri için PostgreSQL doğruluk kaynağıdır. Redis bu verilerin kontrollü cache/projeksiyonlarını ve olay akışlarını tutar. Kritik değişiklikler önce yetkilendirilir, kalıcı işlem tamamlanır, ardından güvenli cache invalidation/outbox akışı uygulanır.

**Kontrol düzlemi ayrımı:** Redis yönetim işlemleri iş uygulamasının normal kullanıcı yetkilerinden ayrıdır. Tehlikeli node işlemleri onay, değişiklik kaydı, sağlık kontrolü ve rollback gerektirir.

## 4. Modüller

| Modül | Temel sorumluluk |
| --- | --- |
| Identity & Organization | Kullanıcı, rol, departman, görev |
| Human Resources | Personel, maaş, maaş geçmişi; İK yetkisi |
| Network Operations | Ağ varlıkları, cihazlar, operasyon talepleri |
| Service Desk | Her departman için ticket açma, atama, SLA |
| Product & Marketing | Ürün kataloğu, fiyat, kampanya, onay |
| Advertising | Ana sayfa banner ve içerik yayınlama |
| Reporting | Rol ve veri kapsamına göre Excel/CSV dışa aktarma |
| Redis Intelligence | HIT/MISS, Redis–SQL süreleri, TTL, bellek |
| Redis Control Plane | Cluster, node, ACL, bakım ve izleme |

## 5. Erişim ilkeleri

- **Varsayılan ret:** Açıkça izin verilmeyen işlem engellenir.
- **İK:** Yetkilendirilmiş İK rolleri maaş değişikliği yapabilir.
- **Network:** Ağ varlıklarını yönetebilir; maaş ve ürün fiyatını değiştiremez.
- **Marketing:** Yetkisi dahilinde ürün fiyatı/kampanya yönetebilir; maaş değiştiremez.
- **Advertising:** Onaylı reklam alanlarına içerik yayınlayabilir.
- **Tüm departmanlar:** Kendi yetki ve kapsamına göre ticket açabilir.
- **Redis operatörleri:** Normal iş rollerinden bağımsız, ayrı yetki ve denetim gerektirir.

Arayüzde bir butonun gizlenmesi güvenlik sayılmaz: kontroller API, veri katmanı ve ağ seviyesinde de uygulanır. Kişisel/maaş bilgileri için yetkisiz cache ve export yasaktır.

## 6. Repository yapısı

```text
01-DOCS/                 Mimari, güvenlik ve çalışma dokümanları
02-FRONTEND/             Next.js portal
03-BACKEND/              Modüler .NET iş katmanı
04-REDIS-ENGINE/         Cache, Streams, benchmark ve tanılama
05-REDIS-CONTROL-PLANE/  Redis yönetimi ve orkestrasyon
06-SECURITY/             Kimlik, yetki ve ağ güvenliği
07-DATABASE/             Şema, migration, seed ve veri tasarımı
08-WORKERS/              Asenkron arka plan işlemleri
09-OBSERVABILITY/        Metrik, log, trace ve alarmlar
10-INFRASTRUCTURE/       Docker, Kubernetes, OpenShift
11-TESTS/                Birim, entegrasyon, yetki, yük testleri
12-DEVOPS/               CI/CD ve operasyon betikleri
13-DEMO-LAB/             Sentetik veriler ve deney senaryoları
```

## 7. Kurulum durumu

Kök dizindeki `.env.example` ve Compose dosyaları sonraki paketlerde eklenecek. Bu aşamada `docker compose up` veya `dotnet run` komutlarının çalışacağı varsayılmamalıdır. Uygulama hazır olduğunda kurulum adımları burada doğrulanmış komutlarla yayınlanacaktır.

## 8. Güvenlik ve test verisi

Gerçek çalışan, maaş, müşteri veya kurumsal erişim bilgilerini geliştirme/demo ortamına yüklemeyin. Gizli anahtarları Git'e eklemeyin. Gerçek Redis node'ları üzerinde detach, failover ve upgrade işlemleri yalnızca ayrıca yetkilendirilmiş ortamlarda çalıştırılacaktır.

## 9. Proje referansı

Temel gereksinimler: `redis-vs-redis-enterprise-calisma(5).md`. Redis OSS ve Redis Enterprise'ın aynı özellik düzeyinde olduğu varsayılmaz; ürünün amacı seçilmiş kurumsal yönetim yeteneklerini kontrollü biçimde geliştirmektir.











==========================================================
 REDIS01 — KULLANICI HESAPLARI
==========================================================
 Kullanici : koru_admin
 Sifre     : sM1WexIhZls-WVjmwENJBCQHitnkj8Y0ZBMBIK5alJ-jH7GL
----------------------------------------------------------
 Kullanici : hr
 Sifre     : sEg_SlI23p_gFP85zmL5P0SLX44viNRdxaD5Ci-p3p7_v4JF            lzUc_ohs_cb5e64mCpQgF1vdtouAJKmChRugMX-UF7r3kVbJ
----------------------------------------------------------
 Kullanici : marketing
 Sifre     : ffmw67BKaKB7emqCbBaTStjGhccwBxwWg4PHEJNs1f6zqcyK
----------------------------------------------------------

==========================================================
 REDIS02 — KULLANICI HESAPLARI
==========================================================
 Kullanici : koru_admin
 Sifre     : oj9qqJ1s7kK0vRZWJcMqL_WvBypzNyBryJpyeqbpPrEBmbqR
----------------------------------------------------------
 Kullanici : it
 Sifre     : cWkS6nPDTJDlrWM4ovUg3S4xjNtkU0kZb68vBN840t8yIgxs
----------------------------------------------------------

==========================================================
 REDIS03 — KULLANICI HESAPLARI
==========================================================
 Kullanici : koru_admin
 Sifre     : gdBan9xRiqfGBbY93loyP5m1NYcFWePpTfRxwx3-SOEwm-Hx
----------------------------------------------------------
 Kullanici : network
 Sifre     : rvo1AWNeoYjjD3A7hu_sOP-DHzbq0jAAIRmpKyW7T30fVOwD
----------------------------------------------------------

==========================================================
 LEGACY REDIS CACHE / STREAMS
==========================================================

 Redis Cache (6379)
 Container : koru-one-redis-cache-1
 Sifre     : change-me-local-cache

 Redis Streams (6380)
 Container : koru-one-redis-streams-1
 Sifre     : change-me-local-streams

==========================================================
 SIFRE LISTESI TAMAMLANDI
==========================================================







Yönetici
Kullanıcı: demo.admin
Şifre: _B0eLo0z-DNxmsjKaj5cfNlW
Rol: admin

İK
Kullanıcı: demo.hr
Şifre: t4L2xOMRTq5ihrJzhuVUB8Xy
Rol: hr

Network
Kullanıcı: demo.network
Şifre: 0Un5TvHqGPjquGwHqidjxFS3
Rol: network

IT
Kullanıcı: demo.it
Şifre: B0qHKlvUALHMKeNnMVqZ_BJA
Rol: it

Pazarlama
Kullanıcı: demo.marketing
Şifre: 0taXolSHC1Tk7g3pCK_MZIHp
Rol: marketing

Reklam
Kullanıcı: demo.advertising
Şifre: 2RU3oMrZ2QrlsPwvDk5G_ZAr
Rol: advertising

Redis İzleme
Kullanıcı: demo.redis.viewer
Şifre: Y1eFCmUyW5Y9vlWLo2Lvj6IQ
Rol: redis-viewer

Redis Operasyon
Kullanıcı: demo.redis.operator
Şifre: btPqUoM_PtrYT57bk2g_fXig
Rol: redis-operator


!!!!!!KOD CALISTIRMA ICIN!!!!!!

Terminal — Docker, PostgreSQL, Redis Cache ve Streams:

cd /workspaces/redivanta-platform

bash <<'KORU_CORE'
set -Eeuo pipefail

python3 - <<'PY'
import json, os, subprocess, sys, time

services = {
    "postgres": ("koru-one-postgres-1", "/var/lib/postgresql/data", "_postgres_data", "5432/tcp", "POSTGRES_PORT"),
    "redis-cache": ("koru-one-redis-cache-1", None, None, "6379/tcp", "REDIS_CACHE_PORT"),
    "redis-streams": ("koru-one-redis-streams-1", "/data", "_redis_streams_data", "6379/tcp", "REDIS_STREAMS_PORT")
}

def run(args, env=None):
    return subprocess.run(args, capture_output=True, text=True, env=env)

def inspect(name):
    r=run(["docker","inspect",name])
    if r.returncode:
        raise RuntimeError(f"{name}: mevcut container bulunamadi. Veri korunmasi icin durduruldu.")
    return json.loads(r.stdout)[0]

print("=== KORU ONE CORE DOCKER START ===")

if run(["docker","info"]).returncode:
    sys.exit("Docker daemon calismiyor.")

for service, (name, destination, suffix, port_key, port_env) in services.items():
    print(f"\n=== {service.upper()} ===")
    info=inspect(name)
    envs=dict(v.split("=",1) for v in info["Config"]["Env"] if "=" in v)
    env=os.environ.copy()

    if destination:
        matching=[
            m for m in info.get("Mounts",[])
            if m.get("Type")=="volume"
            and m.get("Destination")==destination
            and m.get("Name","").endswith(suffix)
        ]
        if len(matching)!=1:
            raise RuntimeError(f"{name}: kalici volume dogrulanamadi.")

        if run(["docker","volume","inspect",matching[0]["Name"]]).returncode:
            raise RuntimeError(f"{name}: volume bulunamadi.")

        print("[OK] Kalici veri volume'u dogrulandi")

    bindings=(info["HostConfig"].get("PortBindings") or {}).get(port_key,[])
    if len(bindings)!=1 or not bindings[0].get("HostPort"):
        raise RuntimeError(f"{name}: mevcut port dogrulanamadi.")

    env[port_env]=bindings[0]["HostPort"]

    if service=="postgres":
        for k in ("POSTGRES_DB","POSTGRES_USER","POSTGRES_PASSWORD"):
            if k not in envs:
                raise RuntimeError(f"Eksik PostgreSQL ayari: {k}")
            env[k]=envs[k]
    else:
        if "REDIS_PASSWORD" not in envs:
            raise RuntimeError(f"{name}: Redis sifresi eksik.")
        key="REDIS_CACHE_PASSWORD" if service=="redis-cache" else "REDIS_STREAMS_PASSWORD"
        env[key]=envs["REDIS_PASSWORD"]
        if service=="redis-cache":
            env["REDIS_CACHE_MAXMEMORY"]=envs.get("REDIS_CACHE_MAXMEMORY","256mb")

    if info["State"]["Running"]:
        print("[OK] Zaten calisiyor")
        continue

    started=run(["docker","start",name])

    if started.returncode==0:
        print("[OK] Container baslatildi")
        continue

    failure=started.stdout+started.stderr
    if "RWLayer" not in failure and "unexpectedly nil" not in failure:
        raise RuntimeError(f"{name}: baslatilamadi: {failure[-250:]}")

    print("[ONARIM] Docker RWLayer hatasi")

    removed=run(["docker","rm","-f",name])
    if removed.returncode:
        raise RuntimeError(f"{name}: eski container kaldirilamadi")

    created=run([
        "docker","compose","-f","docker-compose.yml",
        "up","-d","--no-deps",service
    ],env=env)

    if created.returncode:
        raise RuntimeError(f"{name}: yeniden olusturma basarisiz: {created.stderr[-250:]}")

    print("[OK] Mevcut ayarlar ve kalici volume ile kurtarildi")

print("\n=== HEALTH CHECK ===")

checks={
    "postgres":'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"',
    "redis-cache":'REDISCLI_AUTH="$REDIS_PASSWORD" redis-cli ping',
    "redis-streams":'REDISCLI_AUTH="$REDIS_PASSWORD" redis-cli ping'
}

for service,(name,*_) in services.items():
    ready=False
    for _ in range(30):
        r=run(["docker","exec",name,"sh","-c",checks[service]])
        if r.returncode==0:
            ready=True
            break
        time.sleep(2)
    if not ready:
        raise RuntimeError(f"{service}: hazirlik kontrolu basarisiz")
    print(f"[OK] {service}")

print("\nCORE DOCKER HAZIR")
PY

KORU_CORE


Keycloak (8081) ve Redis Insight (5540):

cd /workspaces/redivanta-platform

bash <<'KORU_KEYCLOAK'
set -Eeuo pipefail

python3 - <<'PY'
import json, os, subprocess, sys, time
from pathlib import Path
from urllib.request import urlopen

def run(args,env=None):
    return subprocess.run(args,capture_output=True,text=True,env=env)

code=os.environ.get("CODESPACE_NAME")
if not code:
    sys.exit("Bu komut GitHub Codespaces ortaminda calistirilmali.")

domain=os.environ.get("GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN","app.github.dev")
hostname=f"https://{code}-3000.{domain}/auth"

overlay=Path("/tmp/koru-keycloak-current.yml")
overlay.write_text(
    "services:\n"
    "  keycloak:\n"
    "    command: [\"start-dev\", \"--http-port=8080\", \"--http-relative-path=/auth\", \"--import-realm\"]\n"
    "    environment:\n"
    f"      KC_HOSTNAME: \"{hostname}\"\n"
    "      KC_PROXY_HEADERS: xforwarded\n"
)

compose=[
    "docker","compose",
    "-f","docker-compose.yml",
    "-f","docker-compose.dev.yml",
    "-f",str(overlay)
]

items=[
    ("keycloak","koru-one-keycloak-1","/opt/keycloak/data","_keycloak_dev_data","8080/tcp","KEYCLOAK_PORT"),
    ("redisinsight","koru-one-redisinsight-1","/data","_redisinsight_data","5540/tcp","REDISINSIGHT_PORT")
]

print("=== KEYCLOAK + REDIS INSIGHT ===")

for service,name,destination,suffix,port_key,port_env in items:
    print(f"\n=== {service.upper()} ===")
    r=run(["docker","inspect",name])
    if r.returncode:
        raise RuntimeError(f"{name}: onceki container bulunamadi; veri korunmasi icin durduruldu.")

    info=json.loads(r.stdout)[0]
    mounts=[
        m for m in info.get("Mounts",[])
        if m.get("Destination")==destination
        and m.get("Type")=="volume"
        and m.get("Name","").endswith(suffix)
    ]

    if len(mounts)!=1:
        raise RuntimeError(f"{name}: kalici volume dogrulanamadi.")

    env=os.environ.copy()
    old=dict(v.split("=",1) for v in info["Config"]["Env"] if "=" in v)
    ports=(info["HostConfig"].get("PortBindings") or {}).get(port_key,[])

    if len(ports)!=1 or not ports[0].get("HostPort"):
        raise RuntimeError(f"{name}: port dogrulanamadi")

    env[port_env]=ports[0]["HostPort"]

    if service=="keycloak":
        env["KEYCLOAK_ADMIN"]=old.get("KC_BOOTSTRAP_ADMIN_USERNAME","admin")
        if "KC_BOOTSTRAP_ADMIN_PASSWORD" not in old:
            raise RuntimeError("Mevcut Keycloak admin yapilandirmasi bulunamadi")
        env["KEYCLOAK_ADMIN_PASSWORD"]=old["KC_BOOTSTRAP_ADMIN_PASSWORD"]

    running=info["State"]["Running"]
    stale=service=="keycloak" and old.get("KC_HOSTNAME")!=hostname

    if running and not stale:
        print("[OK] Zaten calisiyor")
        continue

    if stale:
        print("[ONARIM] Codespace Keycloak hostname yenileniyor")
    else:
        attempt=run(["docker","start",name])
        if attempt.returncode==0:
            print("[OK] Baslatildi")
            continue
        if "RWLayer" not in (attempt.stdout+attempt.stderr) and "unexpectedly nil" not in (attempt.stdout+attempt.stderr):
            raise RuntimeError(f"{name}: {attempt.stderr[-250:]}")
        print("[ONARIM] RWLayer hatasi")

    removed=run(["docker","rm","-f",name])
    if removed.returncode:
        raise RuntimeError(f"{name}: eski container kaldirilamadi")

    created=run(compose+["up","-d","--no-deps",service],env=env)
    if created.returncode:
        raise RuntimeError(f"{name}: yeniden olusturulamadi: {created.stderr[-250:]}")

    print("[OK] Kalici volume korunarak baslatildi")

print("\n=== KEYCLOAK HTTP TEST ===")

url="http://127.0.0.1:8081/auth/realms/koru/.well-known/openid-configuration"

ready=False
for _ in range(60):
    try:
        with urlopen(url,timeout=4) as response:
            ready=response.status==200
        if ready:
            break
    except Exception:
        pass
    time.sleep(2)

if not ready:
    raise RuntimeError("Keycloak HTTP 200 vermedi. Docker loglarini incele.")

print("[OK] KEYCLOAK HTTP 200")
print("[OK] REDIS INSIGHT CONTAINER KONTROLU TAMAMLANDI")
PY

KORU_KEYCLOAK


Redis 01, 02, 03 ve diğer yönetilen Redis'ler:

cd /workspaces/redivanta-platform

bash <<'KORU_MANAGED_REDIS'
set -Eeuo pipefail

python3 - <<'PY'
import importlib.util
import json
import os
import subprocess
import time
from pathlib import Path

root=Path("/workspaces/redivanta-platform")
base=Path(os.environ.get(
    "KORU_REDIS_HOME",
    str(Path.home()/".local/share/koru-one/redis-managed")
)).expanduser().resolve()

registry_file=base/"registry.json"
secrets_file=base/"secrets.json"
controller=root/"05-PLATFORM/redis-managed/koru_redisctl.py"

for f in (registry_file,secrets_file,controller):
    if not f.is_file():
        raise RuntimeError(f"Eksik dosya: {f}")

registry=json.loads(registry_file.read_text())
secrets=json.loads(secrets_file.read_text())

spec=importlib.util.spec_from_file_location("koru_redisctl",controller)
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

def run(*args,**kw):
    return subprocess.run(
        ["docker",*args],
        capture_output=True,text=True,**kw
    )

print("=== MANAGED REDIS START ===")

for node,cfg in sorted(registry.items()):
    name=cfg.get("container",f"koru-v87-{node}")
    print(f"\n=== {node.upper()} ===")

    result=run("inspect",name)
    if result.returncode:
        raise RuntimeError(f"{node}: container bulunamadi")

    info=json.loads(result.stdout)[0]

    data=(base/f"{node}-data").resolve()
    acl=(base/f"{node}.acl").resolve()

    def mounted(destination,source):
        return any(
            m.get("Type")=="bind"
            and m.get("Destination")==destination
            and Path(m.get("Source","/")).resolve()==source
            for m in info.get("Mounts",[])
        )

    if not data.is_dir() or not acl.is_file():
        raise RuntimeError(f"{node}: veri klasoru veya ACL eksik")

    if not mounted("/data",data) or not mounted("/etc/redis/koru.acl",acl):
        raise RuntimeError(f"{node}: mevcut bind mount dogrulanamadi")

    if not secrets.get(node,{}).get("koru_admin"):
        raise RuntimeError(f"{node}: mevcut admin kimlik bilgisi eksik")

    if info["State"]["Running"]:
        print("[OK] Zaten calisiyor")
        continue

    attempt=run("start",name)

    if attempt.returncode==0:
        print("[OK] Baslatildi")
        continue

    failure=attempt.stdout+attempt.stderr
    if "RWLayer" not in failure and "unexpectedly nil" not in failure:
        raise RuntimeError(f"{node}: {failure[-250:]}")

    print("[ONARIM] RWLayer hatasi")

    removed=run("rm","-f",name)
    if removed.returncode:
        raise RuntimeError(f"{node}: bozuk container kaldirilamadi")

    module.launch(node,int(cfg["port"]),int(cfg["memoryMb"]))
    print("[OK] Mevcut AOF ve ACL ile yeniden olusturuldu")

print("\n=== ACL PING TESTLERI ===")

for node,cfg in sorted(registry.items()):
    name=cfg.get("container",f"koru-v87-{node}")
    password=secrets[node]["koru_admin"]
    ready=False

    for _ in range(20):
        result=run(
            "exec","-i",name,
            "sh","-c",
            'IFS= read -r REDISCLI_AUTH; export REDISCLI_AUTH; '
            'redis-cli --user koru_admin PING',
            input=password+"\n"
        )

        if result.returncode==0 and result.stdout.strip()=="PONG":
            ready=True
            break
        time.sleep(1)

    if not ready:
        raise RuntimeError(f"{node}: ACL PING basarisiz")

    print(f"[OK] {node.upper()}: PONG")

print("\nMANAGED REDIS HAZIR")
PY

KORU_MANAGED_REDIS



Ana Backend API (8080):

cd /workspaces/redivanta-platform

bash <<'KORU_BACKEND'
set -Eeuo pipefail
set +x

echo "=== KORU ONE BACKEND :8080 ==="

export ASPNETCORE_ENVIRONMENT=Development
export KORU_ALLOW_LOCAL_DOCKER_ADMIN=1
export OIDC_AUDIENCE=koru-api

export OIDC_METADATA_ADDRESS="http://127.0.0.1:8081/auth/realms/koru/.well-known/openid-configuration"

curl -fsS "$OIDC_METADATA_ADDRESS" -o /tmp/koru-oidc.json

export OIDC_AUTHORITY="$(
  python3 -c 'import json;print(json.load(open("/tmp/koru-oidc.json"))["issuer"])'
)"

export REDIS_CACHE_PASSWORD="$(
  docker exec koru-one-redis-cache-1 printenv REDIS_PASSWORD
)"

export REDIS_STREAMS_PASSWORD="$(
  docker exec koru-one-redis-streams-1 printenv REDIS_PASSWORD
)"

export REDIS_URL="127.0.0.1:6379,password=${REDIS_CACHE_PASSWORD},abortConnect=false,allowAdmin=true"

export REDIS_STREAMS_URL="127.0.0.1:6380,password=${REDIS_STREAMS_PASSWORD},abortConnect=false,allowAdmin=true"

PG_DB="$(docker exec koru-one-postgres-1 printenv POSTGRES_DB)"
PG_USER="$(docker exec koru-one-postgres-1 printenv POSTGRES_USER)"
PG_PW="$(docker exec koru-one-postgres-1 printenv POSTGRES_PASSWORD)"

export DATABASE_URL="Host=127.0.0.1;Port=5432;Database=${PG_DB};Username=${PG_USER};Password=${PG_PW}"

echo "=== BACKEND BUILD ==="

dotnet build \
  03-BACKEND/KoruOne.Api/KoruOne.Api.csproj \
  --no-restore --nologo -v:q

echo "=== BACKEND START ==="

dotnet run \
  --project 03-BACKEND/KoruOne.Api/KoruOne.Api.csproj \
  --no-build \
  --no-launch-profile \
  --urls http://0.0.0.0:8080

KORU_BACKEND



Redis Control API (8082)


cd /workspaces/redivanta-platform

bash <<'KORU_CONTROL'
set -Eeuo pipefail
set +x

echo "=== KORU REDIS CONTROL API :8082 ==="

export ASPNETCORE_ENVIRONMENT=Development

export OIDC_METADATA_ADDRESS="http://127.0.0.1:8081/auth/realms/koru/.well-known/openid-configuration"

curl -fsS "$OIDC_METADATA_ADDRESS" -o /tmp/koru-oidc.json

export OIDC_AUTHORITY="$(
  python3 -c 'import json;print(json.load(open("/tmp/koru-oidc.json"))["issuer"])'
)"

export REDIS_CACHE_PASSWORD="$(
  docker exec koru-one-redis-cache-1 printenv REDIS_PASSWORD
)"

export REDIS_STREAMS_PASSWORD="$(
  docker exec koru-one-redis-streams-1 printenv REDIS_PASSWORD
)"

echo "=== CONTROL API BUILD ==="

dotnet build \
  04-REDIS/KoruOne.Redis.Control.Api/KoruOne.Redis.Control.Api.csproj \
  --no-restore --nologo -v:q

echo "=== CONTROL API START ==="

dotnet run \
  --project 04-REDIS/KoruOne.Redis.Control.Api/KoruOne.Redis.Control.Api.csproj \
  --no-build \
  --no-launch-profile \
  --urls http://0.0.0.0:8082

KORU_CONTROL





Frontend (3000):





cd /workspaces/redivanta-platform/02-FRONTEND/koru-web

bash <<'KORU_FRONTEND'
set -Eeuo pipefail

echo "=== KORU ONE FRONTEND :3000 ==="

if [ -z "${CODESPACE_NAME:-}" ]; then
  echo "HATA: CODESPACE_NAME bulunamadi."
  exit 1
fi

export NEXT_PUBLIC_OIDC_AUTHORITY="https://${CODESPACE_NAME}-3000.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:-app.github.dev}/auth/realms/koru"

echo "=== DEPENDENCY KONTROL ==="

if [ ! -d node_modules ]; then
  npm ci
fi

echo "=== NEXT.JS START ==="

npm run dev -- --hostname 0.0.0.0 --port 3000

KORU_FRONTEND












