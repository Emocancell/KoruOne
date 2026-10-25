# KORU ONE — Multi-Redis Management Platform

> **Durum:** Gereksinim / mimari taslağı (uygulandı veya canlıya alındı anlamına gelmez). 25 Ekim 2026.
>
> **Hedef:** Redis instance'larını dinamik yönetmek; her instance'a özgü yönetici kimlik bilgileri, her departmana özgü Redis ACL kimlik bilgileri, sınırlandırılmış anahtar erişimi, gerçek kapasite ölçümü ve uçtan uca denetlenebilir bir yönetim arayüzü sağlamak.

## 1. İstenen kullanıcı deneyimi

- Kullanıcı KORU ONE'a kurumsal hesabıyla (Keycloak) girer.
- **Redis Infrastructure** ekranında `Redis 01`, `Redis 02`, `Redis 03` kartlarını; erişimi olan instance'ların sağlık, port, gerçek bellek, key ve kullanım durumlarını görür.
- Kart seçildiğinde **Redis'e Bağlan / Erişim Doğrula** ekranı açılır. Gerektiğinde Redis kullanıcı adı ve şifresi güvenli bir formda girilir; yetki backend tarafından doğrulanır. Kimse yetkili olmadığı Redis'i sadece portunu bilerek açamaz.
- Başarılı girişler, başarısız girişler ve yönetim işlemleri denetim kayıtlarına işlenir: örn. `admin.demo | Redis 01 | login_success | 2026-10-25 15:20 | kullanıcı: admin.demo`.
- Redis ayrıntısı içinde erişim kapsamına göre key listeleme/oluşturma/değer güncelleme/silme, TTL, bellek, istatistikler, ACL kullanıcıları, departman atamaları ve loglar bulunur.
- Yetkili yönetici panelden **Redis 04 ekle**, Redis 02'yi durdur, node şifresini döndür, kapasite ayarını değiştir, node'u decommission et gibi işlemleri kontrollü biçimde yapabilir.

## 2. Kimlik doğrulama: İki ayrı şifre düzeyi

**A. Instance/servis seviyesi kimlik bilgisi:** `redis-01`, `redis-02`, `redis-03` birbirinden bağımsız Redis sunucularıdır. Her birinin ayrı yönetici/servis hesabı ve ayrı güçlü şifresi vardır. Bir instance'ın yönetici şifresi diğerinde geçmez.

**B. Departman/ACL seviyesi kimlik bilgisi:** Aynı Redis 01'e hem İK hem Pazarlama atanabilir. **İK ve Pazarlama farklı Redis ACL kullanıcıları ve farklı şifrelerle** girer; sadece kendilerine izin verilen anahtar alanlarını kullanabilir. Her departman kimliği kendi ACL izinleriyle sınırlandırılır. İK parolası Pazarlama'ya yetki vermez; Pazarlama parolası İK'ya yetki vermez.

**C. KORU ONE hesabı (Keycloak):** Portal kullanıcısının oturumudur. Keycloak rol kontrolü Redis ACL kontrolünün *yerine geçmez*; erişim kararında **hem portal RBAC hem Redis ACL** sağlanmalıdır. Redis parolasının ayrıca istenmesi bir UX/güvenlik tercihi olarak yapılandırılabilir; kaydedilmiş bir parola sessizce başka departmana erişim açmamalıdır.

### Örnek hedef topoloji (atanabilir, sabit değil)

| Instance | Localhost port | Başlangıç departmanı | Instance yöneticisi | Departman ACL hesapları |
|---|---:|---|---|---|
| Redis 01 | 3001 | Human Resources + Marketing | `redis01-admin` / ayrı gizli parola | `hr-user` / farklı parola → `koru:hr:*`; `marketing-user` / farklı parola → `koru:marketing:*` |
| Redis 02 | 3002 | IT Operations | `redis02-admin` / ayrı gizli parola | `it-user` → `koru:it:*` |
| Redis 03 | 3003 | Network | `redis03-admin` / ayrı gizli parola | `network-user` → `koru:network:*` |
| Redis 04 | 3004 (örnek) | Sonradan atanacak | `redis04-admin` / ayrı gizli parola | Yönetici ekledikçe oluşturulacak |

> Bu tabloda **gerçek parola veya token bulunmaz**. Portlar *Redis'in yerel geliştirme host portlarıdır*; container içindeki Redis tipik olarak 6379 dinler. Codespaces dışına/public internete Redis portlarını açmayın; sadece localhost/private Docker network kullanın. 3001–3004 başka servislerle çakışıyorsa uygun boş port tahsis edin.

### Kritik izolasyon ayrımı

- **Aynı instance üzerinde ayrı departman kullanıcıları:** Redis ACL anahtar deseni (`~koru:hr:*`, `~koru:marketing:*`) ve komut izinleriyle **mantıksal izolasyon** sağlanır. Bir departman diğerinin key'lerini okuyamaz/değiştiremez; yetkisiz komutlar reddedilir.
- **Kesin fiziksel izolasyon:** Ayrı süreç/container, bellek limiti, persistence ve ağ sınırı istenirse her departman için **ayrı instance** oluşturulmalıdır. Aynı Redis 01'i kullanan İK ve Pazarlama, veri erişimleri ayrılmış olsa da CPU/RAM/eviction etkilerini paylaşır; Redis OSS ACL kendi başına departman başına gerçek RAM kotası koymaz.

## 3. Dinamik Redis Node Manager

Yalnızca yetkili admin/operatör rollerinde aşağıdaki işlemler sunulur:

1. **Redis Oluştur:** Ad, host port, maksimum bellek, eviction policy, persistence, environment, ilk departman ve güçlü yönetici parolası/secret referansı; otomatik port kontrolü ve sağlık testi.
2. **Redis Düzenle:** Departman atama/kaldırma, ACL kimliği oluşturma/düzenleme/iptal, şifre rotasyonu, limit ve politikaları düzenleme, planlanan kaynakların görünürlüğü.
3. **Redis 04 / 05 / ... Ekle:** Sayı üçle sabitlenmez; kayıtlar PostgreSQL envanterinde tutulur, UI dinamik listeler.
4. **Redis Kaldır / Decommission:** Önce erişimi durdur, veri/backup durumunu göster, etkilenecek uygulamaları uyar, çift onay al, audit oluştur, istenirse korumalı yedek al; **volume ve veriyi varsayılan olarak silme**.
5. **Redis Durum/Health:** Bağlantı, ping süresi, uptime, Redis sürümü, kullanılan bellek, RSS, `maxmemory`, toplam key, TTL, evictions, errors, HIT/MISS.
6. **Storage:** Node bazında gerçek kullanılan byte ve kapasite; ayrıca ACL namespace bazında `MEMORY USAGE` ile ölçülebilen key belleği. Kısmi tarama `partial` olarak belirtilir.

> Dinamik container oluşturma/silme yetkisi doğrudan normal frontend'e veya Docker socket'ini açıkça paylaşan API'ye verilmemeli; allowlist, yetki kontrolü, oran sınırı ve kayıt tutan ayrı bir provisioning katmanı üzerinden yapılmalı.

## 4. Redis 01 detay ekranı — örnek akış

**Redis Infrastructure → Redis 01 → Bağlan → Kimlik Doğrula → Yetkili panel**

- `Kimlik`: Portal hesabı (`admin.demo`) ekranda gösterilir.
- `Redis kullanıcı adı`: Örn. `hr-user` veya `marketing-user`.
- `Redis şifresi`: Maskeli alan, sadece güvenli oturum doğrulaması için kullanılır.
- Sonuç: Başarılıysa **atanmış departmanın** keyspace'i açılır; örn. `koru:hr:*`. Yanlış şifrede/gerekli yetki yoksa giriş reddedilir ve olay loglanır.
- Sekmeler: **Overview | Keys | TTL & Memory | Capacity | Users & ACL | Access Logs | Node Settings** (rol ve kapsamlarına göre gizlenir/engellenir).
- Keys: Sınırlandırılmış/paginated `SCAN`, key tipi, `TTL`, `MEMORY USAGE`, veriyi görüntüleme; yetki varsa key ekle/güncelle/sil. Silme için açık onay ve audit.
- Admin yalnızca yetkilendirilmiş yönetim akışıyla diğer departmanlara erişebilir; her ayrı kapsam erişimi ayrıca loglanır.

## 5. Denetim logları (audit)

Örnek olaylar:

```text
2026-10-25T15:20:10+03:00 | admin.demo | redis-01 | auth_success | scope=hr | result=allowed
2026-10-25T15:22:18+03:00 | admin.demo | redis-01 | key_create   | scope=hr | key=koru:hr:test | result=success
2026-10-25T15:24:02+03:00 | marketing.user | redis-01 | auth_denied | scope=hr | result=forbidden
2026-10-25T15:25:40+03:00 | admin.demo | redis-04 | node_create | result=success
```

**Audit alanları:** Zaman, portal kullanıcı ID/adı, Redis node ID, departman, işlem, sonuç, kaynak/kapsam, isteğe göre request/correlation ID; başarısız erişimler de kaydedilir. Gerekirse güvenli şekilde istemci IP bilgisi eklenir; ham kullanıcı girdilerinden log enjeksiyonu engellenir.

**Asla loglanmayacaklar:** Redis parolası, secret, token, oturum cookie'si, kişisel hassas key değerleri veya key içeriği. Loglar değiştirilemeyecek/sınırlı yetkili şekilde PostgreSQL audit deposunda tutulur; normal kullanıcı geçmişi silemez.

## 6. Parola ve yetki yönetimi

- Yönetici **Add ACL User**, **Assign Department**, **Change/Rotate Password**, **Revoke Access** ve **Test Connection** işlevlerini kullanır.
- Parolalar ilk kurulumda rastgele güçlü oluşturulabilir veya yönetici tarafından belirlenebilir; kurumsal parola politikası zorunludur.
- **README, Git, düz metin PostgreSQL kaydı veya tarayıcı localStorage'a düz parola yazılmaz.** Sunucu tarafı secret manager / güvenli credential store kullanılır; Redis ACL yapılandırması güvenli şekilde saklanır. Backend sadece gerekli yetki kapsamında kullanır.
- Üretim ortamında bağlantı şifrelemesi (TLS), network isolation ve ayrı servis kullanıcıları gerekir.
- Keycloak rollerine ve Redis ACL'ye birlikte bakılır; tüm node'lara otomatik erişim veren tek bir ortak departman parolası yoktur.
- Yanlış parola, yetkisiz namespace, aşırı hızlı deneme ve yüksek riskli silme işlemleri sınırlanır/denetlenir.

## 7. Frontend — profesyonel UX hedefi

**Redis Infrastructure:** Aranabilir/sıralanabilir kart veya tablo, node durumu ve departman etiketleri, port, kapasite, key sayısı, son metrik zamanı. **Add Redis** ve yalnızca admin için yönetim aksiyonları.

**Redis Node Detail:** Bağlantı modalı (Redis ACL kullanıcı adı ve şifre), kaynak istatistikleri, keyspace tarayıcısı, Redis komutlarını doğrudan paylaşmayan güvenli iş akışları, erişim logları, parola yönetimi, capacity plan ve güvenli decommission.

**Storage & Capacity:** Fiziksel node belleği (`INFO used_memory`) ile departman namespace'lerinin key belleği ayrıştırılır. `0 B` yalnızca gerçekten key yoksa gösterilir; 2 KB, 12 KB gibi küçük değerler sıfıra yuvarlanmaz. Örnekleme eksikse açıkça **kısmi ölçüm** gösterilir. Kullanım limitleri, trend ve alarmlar node bazında hesaplanır.

**Role-aware UI:** Menüde ilgili yetki bulunmayan işlevler açılmaz; fakat güvenlik kontrolleri mutlaka backend ve Redis ACL'de de uygulanır.

## 8. Redis Insight entegrasyonu

- Redis Insight (ürün adı bu şekilde) local geliştirme ortamına kurulabilir ve Redis 01/02/03 ayrı bağlantılar olarak eklenir.
- Her bağlantıda **ilgili Redis ACL kullanıcı adı ve şifresi** kullanılır. Redis Insight'ın bağlantı bilgileri KORU ONE kullanıcılarına otomatik ayrıcalık vermez.
- **Önemli:** Redis Insight üzerinden doğrudan yapılan komutlar, tek başına KORU ONE portal audit loglarına düşmez. Redis Insight kullanımını da kişi/işlem bazında denetlemek istenirse ayrı erişim katmanı, Redis ACL loglarının yeterli olmadığı durumlar için ağ geçidi/uygun altyapı veya ayrı denetim yöntemi tasarlanmalıdır. KORU ONE audit kapsamı doğrudan KORU ONE üzerinden yapılan işlemler içindir.

## 9. Güvenli geliştirme ve geçiş

1. Mevcut KORU ONE çalışır durumda tutulur. PostgreSQL, mevcut Redis Cache/Streams ve mevcut volume'lar silinmez.
2. Docker Compose ile üç yeni, birbirinden bağımsız Redis instance'ı ve farklı gizli parolaları tanımlanır; host portları localhost'a bağlanır.
3. Redis 01 üzerinde `hr-user` ve `marketing-user` farklı ACL parolaları, ayrı key pattern'ları ve sınırlı komut izinleriyle oluşturulur.
4. PostgreSQL'de **Node Registry, Node–Department–ACL Assignment, Secret References ve Audit** metadata şemaları oluşturulur.
5. Backend'e yetki kontrollü provisioning ve node erişim API'leri eklenir; mevcut app cache/streams bağlantıları etkilenmeden kademeli taşınır.
6. Frontend'e yeni Redis Infrastructure, Redis Detail, ACL User Manager, Keyspace Explorer, Storage & Capacity ve Audit ekranları eklenir.
7. Redis Insight'a bağlantı tanımları manuel/uygun güvenli yöntemle eklenir.
8. Pozitif/negatif testler yapılır: İK key'ini Pazarlama'nın okuyamaması, hatalı parola, doğru kullanıcıyla okuma/yazma, parolanın loglanmaması, node 04 oluşturma/decommission, kapasite değişiklikleri, rollback.

## 10. Kabul kriterleri

- [ ] Redis 01, 02 ve 03 farklı instance yönetim şifrelerine sahip, ağ erişimi private.
- [ ] Redis 01 üzerinde İK ve Pazarlama **farklı ACL kullanıcıları ve şifreleri** ile ayrılmış.
- [ ] İK, Pazarlama key'lerini okuyamaz veya silemez; tersi de geçerli.
- [ ] Portalda Redis 01/02/03 tıklanabilir; yetkili bağlantı doğrulama ekranı vardır.
- [ ] Başarılı/başarısız erişimler, key değişiklikleri ve admin işlemleri kullanıcı bazında audite yazılır; **parola/değer içeriği yazılmaz**.
- [ ] Yönetici Redis 04 ve sonrasını ekleyip düzenleyebilir, güvenli biçimde decommission edebilir.
- [ ] Storage limitleri node bazında değiştirilebilir ve Redis'in gerçek ayarlarına karşı doğrulanır; namespace kotasının sadece plan olduğu belirtilir.
- [ ] Redis Insight üç ayrı bağlantıyla çalışır; KORU ONE portal audit'inin kapsamı net tanımlanmıştır.
- [ ] Mevcut cache, stream, Keycloak, PostgreSQL ve önceki uygulama verileri korunarak kademeli geçiş yapılır.

---

**Mimari karar özeti:** Redis 01'de İK + Pazarlama olması mümkündür; fakat bu **paylaşılan fiziksel Redis + ayrı ACL kullanıcıları + farklı parolalar + farklı namespace'ler** demektir. Eğer hedef *hiçbir fiziksel kaynağın dahi paylaşılmamasıysa*, İK ve Pazarlama ayrı Redis instance'larına taşınmalıdır.
