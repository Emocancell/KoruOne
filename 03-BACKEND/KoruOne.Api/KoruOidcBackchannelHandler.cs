
using System.Net.Http;

public sealed class KoruOidcBackchannelHandler : DelegatingHandler
{
    private readonly Uri _publicAuthority;

    public KoruOidcBackchannelHandler(string authority)
        : base(new HttpClientHandler())
    {
        _publicAuthority = new Uri(authority.TrimEnd('/') + "/");
    }

    protected override Task<HttpResponseMessage> SendAsync(
        HttpRequestMessage request,
        CancellationToken cancellationToken)
    {
        var uri = request.RequestUri;

        if (uri != null &&
            uri.AbsoluteUri.StartsWith(
                _publicAuthority.AbsoluteUri,
                StringComparison.OrdinalIgnoreCase))
        {
            // Yalnızca bilinen Keycloak endpoint'i
            // Codespaces içinden yerel adrese yönlendirilir.
            request.RequestUri = new Uri(
                "http://127.0.0.1:8081" +
                uri.PathAndQuery
            );
        }

        return base.SendAsync(request, cancellationToken);
    }
}
