# KORU ONE — Katkı ve Geliştirme Rehberi

**Durum:** v0.1 mimari/altyapı aşaması. Bu belge, ekip içinde geliştirme yaparken izlenecek kuralları tanımlar.

## 1. Geliştirme ilkeleri

1. **Güvenlik önce gelir:** Frontend'de bir alanı gizlemek yetkilendirme değildir. Her işlem için backend'de rol, kaynak ve departman kapsamı kontrol edilir.
2. **PostgreSQL kayıt sistemidir:** Maaş, fiyat, ürün, ticket ve onayların kalıcı doğruluk kaynağı PostgreSQL'dir. Redis; cache, sayaç, projeksiyon ve Streams olayları için kullanılır.
3. **Redis görünürdür:** Yeni bir cache davranışı ekleniyorsa HIT/MISS, gecikme, TTL ve invalidasyon etkisi gözlemlenebilir olmalıdır.
4. **İş düzlemi ve Redis yönetim düzlemi ayrıdır:** Sıradan uygulama kullanıcıları node bakım, ACL veya failover işlemleri yapamaz.
5. **Veri sentetiktir:** Geliştirme ve demo ortamlarına gerçek çalışan, maaş, kimlik veya müşteri verisi yüklenmez.
6. **Küçük ve doğrulanabilir değişiklikler:** Her PR belirli bir sorunu çözer; test ve dokümantasyon birlikte güncellenir.

## 2. Proje yapısı

- `02-FRONTEND/`: Next.js web uygulaması.
- `03-BACKEND/`: .NET Business API ve modüller.
- `04-REDIS-ENGINE/`: Redis bağlantısı, cache, Streams ve benchmark altyapısı.
- `05-REDIS-CONTROL-PLANE/`: Redis envanteri, yetkili bakım iş akışları ve kontrol API'si.
- `06-SECURITY/`: Kimlik, yetki ve ağ güvenliği politikaları.
- `07-DATABASE/`: Şemalar, migration ve seed verileri.
- `11-TESTS/`: Birim, entegrasyon, yetkilendirme ve dayanıklılık testleri.

> Klasörlerin bir kısmı henüz oluşturulmadı. Bu rehber, hedef repository yapısını esas alır.

## 3. Yerel kurulum

Ön koşullar: Git, Docker Compose; frontend için Node.js 22+ ve pnpm; backend için .NET 10 SDK.

```bash
cp .env.example .env
# .env içindeki yerel parolaları değiştirin.
docker compose config --quiet
docker compose up -d
```

İsteğe bağlı geliştirme araçları:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d
```

İsteğe bağlı Redis gözlemlenebilirlik altyapısı:

```bash
docker compose -f docker-compose.yml -f docker-compose.observability.yml up -d
```

Bunlar yalnızca altyapı servislerini başlatır. Web ve .NET servisleri ilgili kodlar oluşturulunca çalışacaktır. Portlar yerel arayüze bağlanır; geliştirme Compose dosyaları üretim için uygun değildir.

## 4. Branch, commit ve PR düzeni

- Branch adları: `feat/kisa-aciklama`, `fix/kisa-aciklama`, `docs/kisa-aciklama`, `security/kisa-aciklama`.
- Commit önerisi: `feat(hr): add salary permission checks`.
- PR açıklamasında **amaç, kapsam, test, veri etkisi, güvenlik etkisi ve rollback** bilgisi bulunmalıdır.
- Şema/Redis anahtar biçimi/API sözleşmesi değişirse uyumluluk ve geçiş planı belirtilir.
- Mimari karar değişiklikleri `01-DOCS/adr/` altında belgelenir.

## 5. Test ve kalite kapıları

- Yeni business kuralı: birim testi.
- Yeni veritabanı, Redis veya kimlik entegrasyonu: entegrasyon testi.
- Maaş, ürün fiyatı, ticket kapsamı, reklam yayınlama: **yetkisiz erişim testi**.
- Redis cache: HIT/MISS, TTL ve invalidasyon testi; performans iddiası varsa ölçüm koşulları.
- Redis node operasyonu: ön kontrol, idempotency, onay, rollback ve başarısızlık senaryosu.
- PR birleştirmeden önce ilgili lint/build/test ve secret taramaları çalıştırılır (CI henüz kurulmamıştır).

## 6. Kod inceleme ve kritik onay

İK maaş, departmanlar arası erişim, ACL, secret, fiyat/onay ve Redis kontrol düzlemi değişikliklerinde ikinci bir inceleme gereklidir. Üretimde etkili bakım ve fiyat/maaş onay akışlarında **maker-checker** ilkesi uygulanır; geliştirici incelemesi işletim onayının yerine geçmez.

## 7. Güvenlik açığı bildirimi

Açıkları herkese açık issue açarak paylaşmayın. `SECURITY.md` içindeki özel bildirim talimatlarını izleyin. Parola, token, bağlantı dizesi ve gerçek kişisel veriyi commit etmeyin.

## 8. Lisans ve üçüncü taraf bileşenler

Katkılar repository'nin `LICENSE` dosyasında belirtilen koşullara tabidir. Redis ve diğer üçüncü taraf yazılımların lisansları ayrıca değerlendirilmelidir. Kurum adına kod veya fikri mülkiyet devri yetkisi varsayılmaz.
