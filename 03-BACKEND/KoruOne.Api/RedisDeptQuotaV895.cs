using System.Collections.Concurrent;
using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using StackExchange.Redis;

public static class RedisDeptQuotaV895
{
    private const int ScanLimit = 500;
    private const long Mb = 1048576L;

    private static readonly ConcurrentDictionary<string,SemaphoreSlim>
        Gates = new();

    private static SemaphoreSlim Gate(string node) =>
        Gates.GetOrAdd(node,_=>new SemaphoreSlim(1,1));

    private static string Home =>
        Environment.GetEnvironmentVariable("KORU_REDIS_HOME") ??
        Path.Combine(
            Environment.GetFolderPath(
                Environment.SpecialFolder.UserProfile),
            ".local/share/koru-one/redis-managed");

    private static string FileName =>
        Path.Combine(Home,"department-quotas-v895.json");

    private static Dictionary<string,Dictionary<string,int>> Read()
    {
        if(!File.Exists(FileName))
            return new();

        return JsonSerializer.Deserialize<
            Dictionary<string,Dictionary<string,int>>>(
                File.ReadAllText(FileName)) ?? new();
    }

    public static int Quota(string node,string department)
    {
        var data=Read();
        return data.TryGetValue(node,out var departments)
            && departments.TryGetValue(department,out var value)
            ? value : 0;
    }

    public static int Allocated(string node,string[] assigned)
    {
        var data=Read();
        if(!data.TryGetValue(node,out var departments))
            return 0;

        return assigned.Sum(d=>
            departments.GetValueOrDefault(d));
    }

    public static async Task<string?> SaveAsync(
        string node,string department,int quotaMb,
        int nodeLimitMb,string[] assigned)
    {
        var gate=Gate(node);
        await gate.WaitAsync();

        try
        {
            if(!assigned.Contains(department))
                return "Departman bu Redis'e atanmamis.";

            if(quotaMb<0 || quotaMb>nodeLimitMb)
                return "Kota 0 ile Redis kapasitesi arasinda olmali.";

            var data=Read();

            if(!data.TryGetValue(node,out var departments))
                data[node]=departments=new();

            var total=assigned.Sum(d=>
                d==department
                    ? quotaMb
                    : departments.GetValueOrDefault(d));

            if(total>nodeLimitMb)
                return $"Toplam {total} MB. Redis limiti {nodeLimitMb} MB.";

            if(quotaMb==0)
                departments.Remove(department);
            else
                departments[department]=quotaMb;

            Directory.CreateDirectory(Home);

            var tmp=FileName+"."+Guid.NewGuid().ToString("N")+".tmp";

            try
            {
                await File.WriteAllTextAsync(
                    tmp,JsonSerializer.Serialize(data));

                if(OperatingSystem.IsLinux())
                    File.SetUnixFileMode(tmp,
                        UnixFileMode.UserRead|UnixFileMode.UserWrite);

                File.Move(tmp,FileName,true);
            }
            finally
            {
                if(File.Exists(tmp))File.Delete(tmp);
            }

            return null;
        }
        finally
        {
            gate.Release();
        }
    }

    public static async Task<(long Used,int Keys,bool Complete)>
        MeasureAsync(IDatabase db,IServer server,string dept)
    {
        var prefix=$"koru:{dept}:*";

        var keys=server.Keys(
            database:0,pattern:prefix,pageSize:100)
            .Take(ScanLimit+1)
            .ToArray();

        bool complete=keys.Length<=ScanLimit;

        var sample=keys.Take(ScanLimit).ToArray();

        long used=0;

        foreach(var batch in sample.Chunk(50))
        {
            var results=await Task.WhenAll(
                batch.Select(key=>
                    db.ExecuteAsync(
                        "MEMORY","USAGE",(RedisKey)key)));

            foreach(var result in results)
            {
                if(!result.IsNull &&
                   long.TryParse(result.ToString(),
                       NumberStyles.Integer,
                       CultureInfo.InvariantCulture,
                       out var number))
                    used+=number;
            }
        }

        return (used,sample.Length,complete);
    }

    public static async Task<bool> WriteAsync(
        string node,string key,string value,
        int ttlSeconds,IDatabase db,IServer server)
    {
        var match=Regex.Match(key,@"^koru:([a-z]+):");
        var dept=match.Success ? match.Groups[1].Value : "";

        var gate=Gate(node);
        await gate.WaitAsync();

        try
        {
            int quota=Quota(node,dept);

            if(quota>0)
            {
                var usage=await MeasureAsync(db,server,dept);

                if(!usage.Complete)
                    throw new InvalidOperationException(
                        "Department quota scan incomplete");

                var old=await db.ExecuteAsync(
                    "MEMORY","USAGE",(RedisKey)key);

                long oldBytes=0;

                if(!old.IsNull)
                    long.TryParse(old.ToString(),out oldBytes);

                long projected=Encoding.UTF8.GetByteCount(value)+512L;
                long next=Math.Max(0,usage.Used-oldBytes)+projected;

                if(next>(long)quota*Mb)
                    return false;
            }

            return await db.StringSetAsync(
                (RedisKey)key,
                (RedisValue)value,
                ttlSeconds>0
                    ? TimeSpan.FromSeconds(ttlSeconds)
                    : null);
        }
        finally
        {
            gate.Release();
        }
    }
}
