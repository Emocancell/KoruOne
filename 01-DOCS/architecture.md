# KORU ONE — Sadeleştirilmiş Sistem Mimarisi

**Sürüm:** v2.1 (birleştirilmiş dosya mimarisi; işlev kapsamı değişmedi)
**Hedef:** Departman bazlı kurumsal portal + Redis'in etkin kullanımını gösteren analitik ekranlar + kontrollü Redis yönetimi.
**Durum:** Mimari tasarım; tamamlanmış/üretime alınmış yazılım değildir.

## 1. Mimari yaklaşım

**Modüler monolit + ayrı Redis yönetim servisi.** Tek Next.js portalı, .NET 10 iş API’si, PostgreSQL 17, Redis 8 ve temel izleme altyapısı bulunur. Redis yönetim API’si ve yetkili operasyon işçisi **ayrı süreç / ayrı servis kimliği** olarak çalışır. Dosyaları birleştirmek yetki sınırlarını birleştirmek anlamına gelmez.

```mermaid
flowchart TB
    Browser[Web Kullanıcısı] --> Web[Next.js Portal]
    Web --> Auth[OIDC / Keycloak]
    Web --> API[.NET 10 API]
    API --> Policy[RBAC + Departman Yetkisi]
    Policy --> BIZ[İK / Network / Ticket / Ürün / Reklam]
    Web --> CONTROL[Redis Control API (ayrı servis)]
    CONTROL --> ControlPolicy[Redis Operator RBAC + MFA / onay]
    BIZ --> PG[(PostgreSQL 17)]
    BIZ --> Redis[(Redis 8)]
    CONTROL --> Redis
    ControlPolicy --> JOB[Onaylı Operasyon İşçisi]
    JOB --> NODES[Redis Sentinel / Cluster Node'ları]
    Redis --> Metrics[Exporter / Prometheus / Grafana]
    Metrics --> API
```

> **Güvenlik:** Business API'nin Redis cache erişimi, Redis node'larını yönetme yetkisi vermez. Kontrol komutları ayrı servis kimliği, sınırlı ACL, onay ve audit ile çalışır.

## 2. Birleştirilmiş klasör ve dosya ağacı

**İlke:** Aynı KORU ONE projesi ve aynı gereksinimler korunur. Onlarca ufak `Service/DTO/Repository/Handler` dosyası yerine iş alanına göre büyük ama anlamlı modüller oluşturulur. Güvenlik sınırı olan Redis yönetim API'si ve worker ise ayrı projeler olarak kalır.

```text
koru-one/
├── README.md, LICENSE, SECURITY.md, CHANGELOG.md, CONTRIBUTING.md
├── .env.example, .gitignore, .editorconfig, .dockerignore
├── docker-compose.yml, docker-compose.dev.yml
├── docker-compose.observability.yml
├── KoruOne.sln, global.json, Directory.Build.props
├── Directory.Packages.props, NuGet.Config
├── package.json, pnpm-workspace.yaml
│
├── 01-DOCS/
│   └── architecture.md                   # TÜM proje / veri / güvenlik / Redis mimarisi
│
├── 02-FRONTEND/
│   └── koru-web/
│       ├── package.json
│       └── src/
│           ├── app/                      # Public + login + rol bazlı portal route'ları
│           ├── modules/
│           │   ├── Dashboard.tsx         # Kişisel / yönetici / departman panelleri
│           │   ├── OrganizationHR.tsx    # Departman, personel, maaş, çizelgeler
│           │   ├── NetworkTickets.tsx    # Envanter, ticket, SLA ve IT grafikleri
│           │   ├── MarketingAds.tsx      # Ürün/fiyat/indirim, banner ve yayınlama
│           │   ├── RedisConsole.tsx      # HIT/MISS, TTL, benchmark, node ekranları
│           │   └── AdminSecurity.tsx     # Roller, erişim, audit, raporlar
│           └── shared/
│               ├── Ui.tsx                # Kurumsal tema, layout, tablo, modal
│               ├── Api.ts                # API client, tipler, hata yönetimi
│               ├── Auth.ts               # OIDC oturum ve UI erişim kuralları
│               └── Charts.tsx            # Ortak grafik ve Excel export arayüzü
│
├── 03-BACKEND/
│   └── KoruOne.Api/
│       ├── Program.cs
│       ├── KoruOne.Api.csproj
│       ├── Modules/
│       │   ├── IdentityOrganization.cs   # Kimlik, kullanıcı, roller, departmanlar
│       │   ├── HumanResources.cs         # İK personel/maaş/yetki/geçmiş
│       │   ├── NetworkServiceDesk.cs     # Network envanter/ticket/SLA
│       │   ├── MarketingAdvertising.cs   # Ürün/fiyat/indirim/reklam/içerik
│       │   └── DashboardReporting.cs     # KPI, filtreli Excel/CSV/PDF raporları
│       └── Infrastructure/
│           ├── DataAccess.cs             # PostgreSQL/EF, transaction/outbox
│           ├── RedisAccess.cs            # Cache/stream/projeksiyon adapter'ı
│           ├── AuthorizationAudit.cs     # RBAC/ABAC, kayıtlama, doğrulama
│           └── EventsExports.cs          # İletiler, bildirim ve dosya export
│
├── 04-REDIS/
│   ├── KoruOne.Redis.Engine/
│   │   ├── KoruOne.Redis.Engine.csproj
│   │   ├── CacheAndStreams.cs           # TTL, HIT/MISS, invalidate, Streams
│   │   └── MetricsAndBenchmarks.cs       # Redis vs SQL, p95/p99, canlı sayaçlar
│   ├── KoruOne.Redis.Control.Api/
│   │   ├── Program.cs                    # AYRI ve yüksek yetkili API
│   │   ├── KoruOne.Redis.Control.Api.csproj
│   │   ├── InventoryMonitoring.cs        # Instance, cluster, sağlık, alarm
│   │   ├── AclAndSecurity.cs             # Redis ACL, erişim, onay/audit
│   │   └── OperationWorkflows.cs         # Preflight, detach/update/attach
│   └── KoruOne.Redis.Worker/
│       ├── Program.cs                    # AYRI operasyon kimliği
│       ├── KoruOne.Redis.Worker.csproj
│       └── NodeAutomation.cs            # Failover, snapshot, validate, rollback
│
├── 05-PLATFORM/
│   ├── database/
│   │   ├── schema.sql                    # Şema taslağı; EF migration'lar üretilir
│   │   └── seed.sql                      # Yalnızca sentetik demo verisi
│   ├── security/
│   │   ├── roles.json                    # Sürüm kontrollü rol/yetki matrisi
│   │   ├── keycloak-realm.json
│   │   └── network-policy.yaml          # Firewall / NetworkPolicy
│   ├── deployment/
│   │   ├── Dockerfile.api
│   │   ├── Dockerfile.web
│   │   ├── Dockerfile.redis-control
│   │   ├── Dockerfile.redis-worker
│   │   └── prometheus.yml
│   └── dashboards/
│       └── redis-overview.json          # Özet Grafana dashboard
│
└── 06-TESTS/
    ├── KoruOne.Tests/
    │   ├── BusinessSecurityTests.cs      # Maaş/fiyat/reklam/ticket izinleri
    │   ├── RedisIntegrationTests.cs      # Cache, Streams, SQL karşılaştırma
    │   └── RedisOperationsTests.cs       # ACL, onay, node yaşam döngüsü
    └── e2e.spec.ts                      # Giriş, rol bazlı sayfalar, export
```

**Notlar:** `src/app/` içinde Next.js dosya tabanlı route'ları zorunlu olduğu ölçüde ayrı dosyalar halinde bulunur. `.csproj`, migration ve framework'ün zorunlu yapılandırma dosyaları ayrıca korunur. Büyük dosyalara birleştirme okunabilirliği veya güvenlik sınırlarını zayıflatırsa ilgili tek modül mantıklı biçimde bölünebilir. Önceden oluşturduğumuz kök dosyalar değiştirilmez.

### Korunan gereksinimler — kapsam değişmez

- **Oturum + kurumsal görünüm:** OIDC/Keycloak, rol bazlı ana sayfa ve dashboard, Vakıf Katılım çizgisinden esinlenen açık tonlar ve sınırlı yeşil vurgu.
- **Organizasyon + İK:** Network kullanıcısına tanımlandığında departman açma; maaşları görme/değiştirme yalnızca uygun İK izinleriyle; maaş çizelgesi ve geçmişi.
- **Network + IT:** Envanter; her departmandan ticket açma, görevlendirme, SLA, ticket istatistikleri.
- **Marketing + reklam:** Ürün (PC vb.), fiyat/indirim/zam, fiyat geçmişi; reklam içerikleri, banner, ana sayfa yayınlama.
- **Redis ön planda:** Cache HIT/MISS, TTL, keyspace, INCR/INFO/DBSIZE, gerçek ölçümlü Redis–PostgreSQL okuma süreleri, Streams, canlı dashboard.
- **Redis Enterprise benzeri kontrol:** Redis instance envanteri, topoloji, Sentinel/Cluster, ACL, node detach/update/validate/attach, failover, backup/restore, rollback, onay, alarm ve audit; Active-Active/Auto Tiering başlangıç kapsamı dışında.
- **Güvenlik:** API RBAC/ABAC, veri kapsamı doğrulama, Redis ACL, WAF, firewall/NetworkPolicy, TLS, audit ve görevler ayrılığı.
- **Çıktılar:** Kullanıcının yetkisine göre filtrelenen Excel/CSV/PDF raporları, Redis benchmark sonuçları ve departman dashboard'ları.
- **Veri tutarlılığı:** PostgreSQL bordro, fiyat ve ticket işlemlerinde kalıcı kaynak; Redis hızlı okuma, sayaç, bildirim, cache ve ölçüm için ön planda.

## 3. Portal ekranları

| Ekran | İçerik | Görme/değiştirme ilkesi |
|---|---|---|
| Giriş ve ana sayfa | Kimlik doğrulama, yayınlanmış reklamlar, ürünler | Public alan herkese; portal içeriği oturum bazlı |
| Genel dashboard | Kişinin görevleri, talepleri, erişebildiği KPI'lar | Kullanıcı/rol kapsamı |
| İK | Personel, maaş geçmişi, maaş analizleri | Maaş değişikliği yalnızca yetkili İK |
| Network | Cihazlar, ağ envanteri, network ticket'ları | Network yetkilileri |
| Service Desk | Ticket oluşturma, takip, SLA | Her departman ticket açabilir; işlem ataması yetkili ekiplere |
| Marketing | Ürün, fiyat, indirim ve fiyat geçmişi | Fiyat değişikliği Marketing yetkililerinde |
| Advertising | Banner, ana sayfa içerikleri, yayın takvimi | Reklam yayınlama yalnızca yetkili içerik yöneticilerinde |
| Redis Intelligence | HIT/MISS, TTL, SQL vs Redis latency, bellek | Gözlem izni olan kullanıcılar |
| Redis Operations | Instance, ACL, node, failover, upgrade, backup | Ayrı Redis Operator/Admin yetkisi + işlem onayı |
| Raporlar | Yetkiye göre filtrelenmiş Excel/CSV dışa aktarımı | API üzerinden yetki tekrar doğrulanır |

### Dashboard örnekleri

- **IT:** Açık / kapanan ticket, öncelik, SLA ihlal oranı, departman bazında dağılım.
- **İK:** Yetkili İK kullanıcılarına maaş bantları, birim bazlı ortalamalar ve değişim eğrileri. Diğer roller için maaş verisi döndürülmez.
- **Marketing:** Ürün sayısı, fiyat değişiklikleri, kampanya performansı.
- **Redis:** İstek/saniye, hit ratio, keyspace, p50/p95/p99 gecikmeleri, kullanılan bellek, replikasyon lag ve node sağlığı.

## 4. Redis / PostgreSQL veri sahipliği

| İşlem | Ana kaynak | Redis görevi |
|---|---|---|
| Personel, maaş, fiyat değişikliği | PostgreSQL | Yetkilendirilmiş okuma projeksiyonları / cache invalidation |
| Ticket açma, atama, kapama | PostgreSQL | Kuyruk sayacı, dashboard projeksiyonu, gerçek zamanlı bildirim |
| Ürün kataloğu / yayınlanmış reklam | PostgreSQL | Yoğun okuma için cache, TTL ve event bazlı invalidation |
| Oturum ve hız sınırlama | Kimlik sağlayıcı + API | Geçici sayaç/oturum yardımcı verileri |
| Redis cluster envanteri / operasyon geçmişi | PostgreSQL | Canlı durum / geçici ölçümler |
| Redis performansı | Ölçüm sistemi | Sayaçlar ve kısa süreli canlı ölçüm cache'i |

**Yazma kuralı:** Para ve bordro verilerini önce Redis'e yazıp sonra belirsiz biçimde veritabanına aktarmayız. Kritik yazım PostgreSQL transaction ile tamamlanır; outbox/event ile Redis projeksiyonu güncellenir veya geçersiz kılınır. Böylece Redis ön planda kullanılırken veri kaybı ve tutarsızlık riski sınırlanır.

**Cache kuralı:** Key isimleri `koru:{module}:{scope}:{id}:v1` biçimindedir. TTL ve invalidation veri sınıfına göre belirlenir. Hassas personel/maaş verisinin genel paylaşımlı cache'lenmesi yasaktır; gerekiyorsa ilgili departmana özel, en az yetkili ve kısa süreli görünüm kullanılır.

## 5. Kimlik, yetki ve firewall

1. Kullanıcı OIDC/Keycloak ile giriş yapar. AD/LDAP entegrasyonu hedeflenir.
2. API her istekte kimliği, rolü, departmanı ve kaynak kapsamını doğrular; yalnızca menü gizlemek güvenlik sayılmaz.
3. Örnek izinler: `hr.salary.write`, `network.asset.write`, `ticket.create`, `marketing.price.write`, `advertising.publish`, `redis.node.operate`.
4. PostgreSQL kayıt düzeyindeki kısıtlar sorgulara uygulanır; gerekli veri alanlarında row-level security değerlendirilir.
5. Redis ACL, uygulama erişimi ile yönetim erişimini ayırır. Uygulama hesaplarına `CONFIG`, `FLUSHALL`, `ACL` gibi yönetim yetkileri verilmez.
6. Dışarıdan yalnızca HTTPS gateway erişilebilir. Redis, PostgreSQL ve metrik servisleri internete açılmaz. Ağ katmanında firewall / NetworkPolicy vardır; WAF ve rate limiting gateway'de uygulanır.
7. Maaş/fiyat değişiklikleri, Redis node operasyonları ve başarısız yetki denemeleri audit edilir. Hassas veri loglara veya benchmark sonuçlarına basılmaz.
8. Kritik Redis operasyonlarında maker-checker (işlemi başlatan ile onaylayan farklı kişi) ilkesi uygulanır.

## 6. Redis Control Plane: hedeflenen özellikler

Yüklenen Redis OSS / Redis Enterprise karşılaştırma çalışmasının temel gereksinimleri korunur:

- Envanter: tüm Redis instance'ları, Sentinel/Cluster topolojisi, sürümler, sorumlu ekipler.
- Merkezi görünürlük: sağlık durumu, gecikme, bellek, hit/miss, replikasyon, alarm.
- ACL: grup bazlı erişim ilkeleri; AD–ACL eşlemesi gelişmiş fazda.
- Backup/restore: test edilmiş yedekleme, geri yükleme ve kayıt tutma.
- Operasyon: **Preflight → (gerekirse Failover) → Drain/Detach → Snapshot → Update → Validate → Sync → Attach → Audit**.
- Hata olursa otomatik trafiğe dönüş yapılmaz; güvenli duruma geçilir ve gerektiğinde rollback devreye alınır.
- Sentinel ve Redis Cluster operasyonları aynı kabul edilmez: Cluster için slot ve istemci yönlendirme kuralları ayrıca ele alınır.

**İlk sürüm kapsamı:** Envanter, read-only monitoring, güvenli ACL görünümü ve kontrollü tek node işlemleri. Otomatik rolling upgrade ve karmaşık failover senaryoları test tamamlandıktan sonra açılır.

**Redis Enterprise notu:** Portal, Redis Enterprise'ın her özelliğini birebir yeniden üretme iddiasında değildir. Active-Active CRDT, Auto Tiering gibi işlevler başlangıç kapsamı dışında tutulur.

## 7. Performans ölçümü

Aynı mantıksal sorgu için API, yetki kapsamında önce PostgreSQL okumasını, ardından aynı veri setinin Redis cache HIT okumasını ölçebilir. Ekranda ayrı ayrı şunlar gösterilir:

- PostgreSQL sorgu süresi (ms)
- Redis okuma süresi (ms)
- Cache HIT / MISS sayısı ve oranı
- p50 / p95 / p99 latency (yeterli örnekle)
- Payload boyutu, veri seti ve eşzamanlı kullanıcı sayısı
- TTL ve cache anahtar istatistikleri

Benchmark üretim sisteminde gizli maaş verisiyle çalıştırılmaz; sentetik test verisi kullanılır. Ölçümler, iki teknolojinin eşdeğer iş yükünü karşılaştıracak biçimde ve cache warm/cold ayrımıyla sunulur.

## 8. Başlangıç dağıtımı

**Lokal:** Docker Compose ile PostgreSQL, Redis Cache, Redis Streams (gerekliyse), API, Web ve isteğe bağlı izleme.
**Kurumsal:** HTTPS ingress + uygulama servisleri + ayrı veri ağı + Redis/PG + Secret Vault + monitoring.
**İş sürekliliği:** Redis devre dışı kaldığında kritik yazma işlemleri PostgreSQL ile sürer; cache tabanlı okumalar kontrollü DB fallback kullanır. Failover senaryoları kapasite testlerinden geçirilir.

## 9. Teslim sırası

1. **Temel:** Login, kurumsal tema, rol bazlı menü, PostgreSQL/Redis bağlantıları.
2. **İş modülleri:** Departmanlar, İK, Network, Ticket, Ürün, Reklam.
3. **Redis görünürlüğü:** HIT/MISS, TTL, latency, Redis vs SQL dashboard, gerçek metrikler.
4. **Güvenlik:** RBAC/ABAC testleri, ACL, export filtreleme, WAF/NetworkPolicy ve audit.
5. **Redis operatörlüğü:** Inventory, preflight, kontrollü detach/attach, snapshot/validate, gözlemlenebilirlik.
6. **Sağlamlaştırma:** E2E, load, failover, backup/restore, rollback ve yayın öncesi güvenlik doğrulaması.

## 10. Mimari kabul kriterleri

- Network kullanıcısı maaş güncelleyemez, Marketing kullanıcısı Network envanterini değiştiremez.
- Tüm departmanlar ticket açabilir; yalnızca atanmış/yetkili ekipler ilgili iş akışlarını yönetebilir.
- Her ekran için veri döndüren API ve export endpoint'i aynı yetki kurallarını uygular.
- Redis dashboard gerçek ölçüm gösterir; sahte HIT/MISS veya latency değeri üretmez.
- Redis kapalıyken kritik işlemler güvenle yürütülür veya kullanıcıya açık hata verilir; sessiz veri kaybı olmaz.
- Redis node değişiklikleri yetki, onay, healthcheck ve audit olmadan yürütülemez.
- Tüm örnek personel, maaş ve ticket verileri sentetiktir.

---

**Tasarım:** Açık arka plan, ölçülü yeşil vurgu, temiz tipografi ve kurumsal panel düzeni. Vakıf Katılım'ın görsel dilinden esinlenilir; kurumsal marka/arma birebir kopyalanmaz.
