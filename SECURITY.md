# KORU ONE — Güvenlik Politikası

**Belge durumu:** Taslak v0.1 · 20 Ekim 2026

KORU ONE; personel, maaş, ürün fiyatı, kurumsal içerik ve Redis yönetim
fonksiyonlarını aynı portalda toplarken **en az yetki, ayrıştırılmış yönetim
katmanı ve izlenebilir işlemler** ilkelerine dayanır.

## 1. Desteklenen sürümler

| Sürüm | Durum |
| --- | --- |
| 0.1.x | Mimari/geliştirme; güvenlik desteği ve üretim uygunluğu henüz ilan edilmedi |
| 1.x | Planlandı; yayımlanmadı |

> Bu repository şu anda üretim ortamı için güvenlik sertifikası veya garanti sunmaz.

## 2. Güvenlik açığı bildirme

- Güvenlik açıklarını **herkese açık GitHub Issue, Discussion veya PR içine**
  exploit ayrıntılarıyla yazmayın.
- Projenin yetkili güvenlik sorumlusuna kurumun **onaylı özel iletişim kanalı**
  üzerinden bildirin. İletişim kanalı yayın öncesinde repository ayarlarında
  tanımlanmalıdır; henüz bir adres belirlenmiş değildir.
- Bildirime etkilenen sürüm, tekrar üretim adımları, etki ve mümkünse
  hassas veri içermeyen log örnekleri ekleyin.
- Gerçek çalışan, maaş, erişim anahtarı veya müşteri verisini bildirimlere koymayın.
- Açığı doğrularken yetkisiz erişim, veri toplama veya servis kesintisi yaratmayın.

## 3. Mimari güvenlik sınırları

| Bileşen | Zorunlu kontrol |
| --- | --- |
| Web portalı | OIDC Authorization Code + PKCE, güvenli oturum cookie'leri, CSRF/XSS önlemleri |
| Business API | Sunucu tarafında deny-by-default RBAC/ABAC, kaynak/departman kapsamı doğrulaması |
| Redis Control API | Ayrı yönetim yetkileri, MFA, kritik işlemlerde maker-checker/onay |
| Redis data plane | TLS, least-privilege ACL, ayrı servis hesapları ve anahtar önekleri |
| PostgreSQL | Ayrı DB rolleri, parametrik sorgular, gerektiğinde row-level security |
| Ağ | WAF/ingress, namespace izolasyonu, default-deny NetworkPolicy, dar port izinleri |
| Gizli bilgiler | Kaynak kodda parola yok; Vault/secret manager, rotasyon ve erişim denetimi |
| Audit | Kim/ne zaman/ne yaptı; append-only veya değiştirilmeye dirençli saklama |

**Önemli:** WAF, firewall veya Redis ACL tek başına departman yetkilendirmesi
sağlamaz. Maaş veya fiyat değişikliği gibi işlemlerde yetki denetimi API'de
ve gerektiğinde veritabanında zorunludur.

## 4. Departman bazlı erişim örnekleri

- **İK:** Yetkili personelin maaş kaydını görür/değiştirir; her değişiklik audit'e yazılır.
- **Network:** Network varlıklarını ve yetkili olduğu ticket'ları yönetir;
  maaş veya ürün fiyatını değiştiremez.
- **Marketing:** Yetkili ürün/fiyat/indirim iş akışını yönetir;
  İK maaş verisine erişemez.
- **Advertising:** Yetkili içerik ve reklam yayın süreçlerini yönetir;
  Redis node operasyonu yapamaz.
- **Redis Operator:** Atanmış node operasyonlarını yönetir;
  bu rol tek başına İK verisine erişim vermez.
- **Security Auditor:** Yetkili kapsamda audit'i okur; varsayılan olarak
  operasyonel veri ve değişiklik izinleri bulunmaz.

Rollar birden fazla olabilir; aynı kullanıcının birden çok rolü olması
tek başına kısıtlı kaynak kapsamını aşma hakkı vermez.

## 5. Hassas veri ve cache kuralları

1. Maaş, kimlik bilgileri ve benzeri hassas alanların **kaynak kaydı PostgreSQL**'dir.
2. Hassas veri Redis'te ancak açık gerekçeyle, asgari alanlar, kısa TTL,
   erişim izolasyonu, şifreleme ve silme/invalidasyon politikasıyla tutulur.
3. Demo ortamında **yalnızca sentetik veri** kullanılır.
4. Raporlama/export yetki kapsamına göre yapılır; maaş export'u ayrıca denetlenir.
5. Loglara parolalar, tokenlar, bağlantı dizeleri ve maaş alanları yazılmaz.
6. Redis key browser varsayılan kapalıdır; üretimde maskeleme ve audit gerekir.
7. KVKK/BDDK uyumu için saklama, erişim, aktarım ve silme süreçleri ayrıca
   hukuk/uyum değerlendirmesinden geçmelidir.

## 6. Redis Control Plane emniyeti

- `Detach → Update → Validate → Attach` değişiklikleri ön kontrol, onay,
  health-check ve rollback planı olmadan çalıştırılmaz.
- `FLUSHALL`, `DEBUG`, tehlikeli `CONFIG` işlemleri uygulama hesaplarına açılmaz.
- Kontrol düzlemi erişilemez olduğunda veri düzlemi hizmet vermeye devam etmelidir.
- Sentinel ile Redis Cluster operasyonları ayrı adapter ve iş akışlarıdır.
- Backup/restore ve major sürüm geçişi, kurtarma testleri geçmeden üretime alınmaz.

## 7. Geliştirme ve dağıtım kontrol listesi

- [ ] Secrets/dependency/container taramaları CI'da aktif
- [ ] API authorization testleri ve negatif erişim senaryoları başarılı
- [ ] Güvenli giriş/çıkış, MFA ve session expiry test edildi
- [ ] TLS ve ağ izolasyonu doğrulandı
- [ ] Redis ACL ile tehlikeli komutlar sınırlandırıldı
- [ ] Yedek geri yükleme ve failover tatbikatı başarılı
- [ ] PII maskeleme, log sanitization ve export kontrolleri doğrulandı
- [ ] Sorumlu güvenlik bildirim kanalı tanımlandı
- [ ] Redis/diğer üçüncü taraf lisansları ve kurumsal uyum onaylandı

Bu dosya hedeflenen kontrolleri tanımlar; ilgili testler tamamlanmadan
kontrollerin fiilen uygulanmış olduğu iddia edilmez.
