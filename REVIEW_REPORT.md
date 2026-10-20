# KORU ONE v2.2 — Kod inceleme ve düzeltmeler

## Düzeltilenler
- PostgreSQL ilk oluşturulduğunda init.sql otomatik yüklenir (eski volume için manuel migration gerekir).
- Keycloak `koru` realm, tarayıcı istemcisi ve API audience/role mapper tanımları eklendi.
- .NET solution projeleri dahil edildi.
- Redis bağlantısı başarısız olduğunda DI çözümlemesini kırmayan sarmalayıcı eklendi.
- Dashboard cache rol grubuna göre ayrıldı; personel sayısı yalnızca İK/yönetim rolüne sunuluyor.
- Normal kullanıcılar diğer kullanıcıların ticket kayıtlarını listeleyemiyor.
- Ticket sahipliği token subject üzerinden atanıyor.
- Rapor dışa aktarımı 10.000 satırla sınırlandı.
- Cache invalidation tüm dashboard rol anahtarlarını temizliyor.

## Bilinen eksikler / güvenlik sınırları
- Bu sürüm üretime alınamaz: güvenilir kurumsal IdP, MFA, TLS, denetim kayıtları, kolon düzeyi şifreleme, eksiksiz ABAC, migration ve testler gerekli.
- Redis node Detach/Update/Attach otomasyonu tamamlanmış değil.
- PostgreSQL tabanlı iş verisi; Redis güçlü okuma önbelleği, fakat tam Redis Streams event pipeline henüz yok.
- Redis–SQL eşdeğer sorgu kıyası ve gerçek XLSX export eksik; CSV mevcut.
- UI, bütün rollere özel düzenleme formlarını henüz sunmuyor.
- Keycloak realm import yeni veritabanında uygulanır; eski Keycloak volume varsa import atlanabilir.
- Keycloak istemci/mapping davranışı gerçek çalışan ortamda doğrulanmalıdır.
- `dotnet`, `docker` bu inceleme ortamında kurulu değil. Derleme, compose config ve E2E testleri çalıştırılamadı.
- Frontend workspace adı pnpm filtre adıyla eşleştirildi; typecheck/lint scriptleri eklendi.
