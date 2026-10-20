# Changelog

KORU ONE için değişiklikler bu dosyada sürüm bazlı takip edilir.
Biçim: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
Sürümleme hedefi: [Semantic Versioning](https://semver.org/spec/v2.0.0.html)

> **Durum:** Mimari ve planlama aşaması. Aşağıdaki planlanan özellikler henüz
> geliştirilmiş, test edilmiş veya üretime alınmış kabul edilmez.

## [Unreleased]

### Planned
- Kurumsal portal: genel sayfa, OIDC oturum açma, role göre navigasyon.
- Departman modülleri: İK, Network, Service Desk, Marketing ve Advertising.
- Redis odaklı dashboard: HIT/MISS, TTL, latency, throughput ve Redis–PostgreSQL kıyası.
- Redis Control Plane: envanter, ACL, node sağlık durumları, onaylı operasyonlar.
- Güvenlik: API tarafında RBAC/ABAC, Redis ACL, TLS ve ağ segmentasyonu.
- Veri güvenilirliği: PostgreSQL kaynak kayıtları, outbox ve Redis projeksiyonları.
- Denetlenebilir Excel/CSV dışa aktarma ve audit kayıtları.

## [0.1.0] - 2026-10-20

### Added
- KORU ONE ürün adı ve ilk hedef sistem mimarisi tanımlandı.
- Modüler .NET backend, Next.js frontend, Redis Engine ve ayrı Redis Control Plane
  bileşen sınırları tasarlandı.
- Monorepo klasör ağacı ve temel teknoloji tercihleri planlandı.
- Kök seviyesinde temel repo politikaları ve ilk dokümantasyon dosyaları oluşturulmaya başlandı.

### Security
- Finansal/kişisel veriler için PostgreSQL'in kaynak kayıt sistemi olması kararlaştırıldı.
- Departman erişiminin sadece arayüzde değil, API ve veri katmanında da
  doğrulanması tasarım ilkesi olarak belirlendi.

[Unreleased]: #unreleased
[0.1.0]: #010---2026-10-20
