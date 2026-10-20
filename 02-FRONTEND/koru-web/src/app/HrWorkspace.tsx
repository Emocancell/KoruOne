"use client";

import { useCallback, useEffect, useState } from "react";

type Employee = {
  id: number;
  name: string;
  department: string;
  salary: number;
};

export default function HrWorkspace({ token }: { token: string }) {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [name, setName] = useState("");
  const [department, setDepartment] = useState("Human Resources");
  const [salary, setSalary] = useState("");
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const request = useCallback(async (path: string, init: RequestInit = {}) => {
    const response = await fetch(path, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
    });

    if (!response.ok) {
      throw new Error(`İşlem başarısız: HTTP ${response.status}`);
    }

    return response;
  }, [token]);

  const reload = useCallback(async () => {
    try {
      const response = await request("/api/hr/employees");
      setEmployees(await response.json());
      setMessage("");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Liste yüklenemedi.");
    }
  }, [request]);

  useEffect(() => {
    if (token) void reload();
  }, [token, reload]);

  async function hire() {
    if (!name.trim() || !department.trim() || salary === "") {
      setMessage("Tüm personel bilgilerini doldur.");
      return;
    }

    setBusy(true);

    try {
      await request("/api/hr/employees", {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          department: department.trim(),
          salary: Number(salary),
        }),
      });

      setName("");
      setSalary("");
      await reload();
      setMessage("Personel başarıyla kaydedildi.");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Kayıt hatası.");
    } finally {
      setBusy(false);
    }
  }

  async function updateSalary(id: number) {
    const value = drafts[id];

    if (value === undefined || value.trim() === "") {
      setMessage("Yeni maaş tutarını gir.");
      return;
    }

    try {
      await request(`/api/hr/employees/${id}/salary`, {
        method: "PUT",
        body: JSON.stringify({ amount: Number(value) }),
      });

      await reload();
      setMessage("Maaş güncellendi.");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Güncelleme hatası.");
    }
  }

  async function exportCsv() {
    try {
      const response = await request("/api/hr/employees.csv");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");

      link.href = url;
      link.download = "koru-ik-personel.csv";
      link.click();

      URL.revokeObjectURL(url);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "CSV hatası.");
    }
  }

  const totalSalary = employees.reduce(
    (sum, employee) => sum + Number(employee.salary), 0
  );

  const departmentCount = new Set(
    employees.map(employee => employee.department)
  ).size;

  const money = (value: number) =>
    new Intl.NumberFormat("tr-TR", {
      style: "currency",
      currency: "TRY",
      maximumFractionDigits: 2,
    }).format(value);

  return (
    <div className="hr-workspace">
      <div className="hr-heading">
        <div>
          <p className="muted">İNSAN KAYNAKLARI / PERSONEL YÖNETİMİ</p>
          <h2>İnsan Kaynakları Merkezi</h2>
          <p className="muted">
            İşe alım kayıtları, departman dağılımı ve maaş yönetimi.
          </p>
        </div>

        <button className="secondary" onClick={exportCsv}>
          CSV Dışa Aktar
        </button>
      </div>

      <div className="hr-stats">
        <div className="card">
          <span>Toplam Personel</span>
          <strong>{employees.length}</strong>
        </div>
        <div className="card">
          <span>Departman Sayısı</span>
          <strong>{departmentCount}</strong>
        </div>
        <div className="card">
          <span>Toplam Brüt Maaş</span>
          <strong>{money(totalSalary)}</strong>
        </div>
      </div>

      <section className="card">
        <h2>Yeni Personel Kaydı</h2>
        <p className="muted">İşe alınan çalışanı kurumsal envantere ekle.</p>

        <div className="hr-form">
          <label>
            Ad Soyad
            <input
              value={name}
              maxLength={150}
              placeholder="Örn. Ayşe Yılmaz"
              onChange={e => setName(e.target.value)}
            />
          </label>

          <label>
            Departman
            <select
              value={department}
              onChange={e => setDepartment(e.target.value)}
            >
              <option value="Human Resources">İnsan Kaynakları</option>
              <option value="Network">Network</option>
              <option value="IT">IT</option>
              <option value="Marketing">Pazarlama</option>
              <option value="Advertising">Reklam</option>
              <option value="Operations">Operasyon</option>
            </select>
          </label>

          <label>
            Brüt Maaş (TL)
            <input
              type="number"
              min="0"
              step="0.01"
              value={salary}
              placeholder="0.00"
              onChange={e => setSalary(e.target.value)}
            />
          </label>
        </div>

        <button disabled={busy} onClick={hire}>
          {busy ? "Kaydediliyor..." : "+ Personel Ekle"}
        </button>
      </section>

      <section className="card">
        <div className="hr-heading">
          <h2>Personel Envanteri</h2>
          <button className="secondary" onClick={reload}>Yenile</button>
        </div>

        <div className="hr-table-wrap">
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Personel</th>
                <th>Departman</th>
                <th>Brüt Maaş</th>
                <th>Maaş Güncelle</th>
              </tr>
            </thead>
            <tbody>
              {employees.map(employee => (
                <tr key={employee.id}>
                  <td>{employee.id}</td>
                  <td>{employee.name}</td>
                  <td>{employee.department}</td>
                  <td>{money(Number(employee.salary))}</td>
                  <td>
                    <div className="hr-salary-action">
                      <input
                        aria-label={`${employee.name} yeni maaş`}
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder="Yeni tutar"
                        value={drafts[employee.id] ?? ""}
                        onChange={e => setDrafts(previous => ({
                          ...previous,
                          [employee.id]: e.target.value,
                        }))}
                      />
                      <button onClick={() => updateSalary(employee.id)}>
                        Kaydet
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!employees.length && (
            <p className="muted">Henüz personel kaydı bulunmuyor.</p>
          )}
        </div>
      </section>

      {message && <p role="status" className="hr-message">{message}</p>}
    </div>
  );
}
