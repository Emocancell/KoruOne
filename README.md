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
