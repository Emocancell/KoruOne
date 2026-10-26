"use client";

type Props = {
  usedBytes:number|null;
  maxMemoryBytes:number;
};

const mb = 1024 * 1024;

function formatBytes(value:number) {
  return `${(value/mb).toLocaleString("tr-TR",{
    minimumFractionDigits:2,
    maximumFractionDigits:2
  })} MB`;
}

export default function RedisCapacityBarV893({
  usedBytes,maxMemoryBytes
}:Props) {
  const available = usedBytes !== null &&
    Number.isFinite(usedBytes) && usedBytes >= 0;

  const limited = maxMemoryBytes > 0;
  const used = available ? usedBytes : 0;
  const ratio = limited ? used/maxMemoryBytes*100 : 0;
  const percent = Math.min(100,Math.max(0,ratio));
  const remaining = Math.max(0,maxMemoryBytes-used);

  const color = ratio >= 90
    ? "#ae4655"
    : ratio >= 75
      ? "#bb8a35"
      : "#158069";

  return (
    <div style={{marginTop:12,fontSize:12}}>
      <div style={{
        display:"flex",
        flexWrap:"wrap",
        justifyContent:"space-between",
        gap:6,
        color:"#486475"
      }}>
        <strong>
          {available ? formatBytes(used) : "Ölçüm yok"} kullanılıyor
        </strong>
        <span>
          {limited
            ? `${formatBytes(maxMemoryBytes)} atanmış`
            : "Limit tanımsız / sınırsız"}
        </span>
      </div>

      <div style={{
        height:11,
        marginTop:8,
        background:"#e6eef0",
        borderRadius:20,
        overflow:"hidden"
      }}>
        {limited && available &&
          <div
            role="progressbar"
            aria-label="Redis RAM doluluk oranı"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(percent)}
            style={{
              height:"100%",
              width:`${percent}%`,
              background:color,
              transition:"width .3s ease",
              borderRadius:20
            }}
          />
        }
      </div>

      <div style={{
        marginTop:6,
        color:"#718696",
        display:"flex",
        justifyContent:"space-between"
      }}>
        <span>
          {limited && available
            ? `%${ratio.toFixed(2)} dolu`
            : "Yüzde hesaplanamıyor"}
        </span>
        <span>
          {limited && available
            ? `${formatBytes(remaining)} boş`
            : "Üst limit yok"}
        </span>
      </div>
    </div>
  );
}
