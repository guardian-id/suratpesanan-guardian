function buildTableHTML(rows, templateName) {

  if (!rows || rows.length === 0) {

    return [
      '<table class="medicine-table">',
      '<thead>',
      '<tr>',
      '<th>No</th>',
      '<th>Nama Obat</th>',
      '<th>Satuan</th>',
      '<th>Jumlah</th>',
      '<th>Keterangan</th>',
      '</tr>',
      '</thead>',
      '<tbody>',
      '<tr>',
      '<td colspan="5">Data tabel PDF tidak berhasil diekstrak.</td>',
      '</tr>',
      '</tbody>',
      '</table>'
    ].join("");

  }


  // ==========================================================
  // REGULER
  // ==========================================================

  if (templateName === "reguler") {

    const parts = [];

    parts.push(
      '<table class="medicine-table regular-table">'
    );

    parts.push('<thead>');

    parts.push('<tr>');

    parts.push('<th>No</th>');
    parts.push('<th>Nama Obat</th>');
    parts.push('<th>Satuan</th>');
    parts.push('<th>Jumlah</th>');
    parts.push('<th>Keterangan</th>');

    parts.push('</tr>');

    parts.push('</thead>');

    parts.push('<tbody>');


    for (const row of rows) {

      parts.push('<tr>');

      parts.push(
        '<td>' +
        escapeHTML(row.no) +
        '</td>'
      );

      parts.push(
        '<td>' +
        escapeHTML(row.nama) +
        '</td>'
      );

      parts.push(
        '<td>' +
        escapeHTML(row.satuan) +
        '</td>'
      );

      parts.push(
        '<td>' +
        escapeHTML(row.jumlah) +
        '</td>'
      );

      parts.push(
        '<td>' +
        escapeHTML(row.keterangan) +
        '</td>'
      );

      parts.push('</tr>');

    }


    parts.push('</tbody>');

    parts.push('</table>');


    return parts.join("");

  }


  // ==========================================================
  // PREKURSOR
  // ==========================================================

  const parts = [];

  parts.push(
    '<table class="medicine-table precursor-table">'
  );

  parts.push('<thead>');

  parts.push('<tr>');

  parts.push('<th>No</th>');
  parts.push('<th>Nama Obat</th>');
  parts.push('<th>Satuan</th>');
  parts.push('<th>Zat Aktif</th>');
  parts.push('<th>Bentuk</th>');
  parts.push('<th>Jumlah</th>');
  parts.push('<th>Keterangan</th>');

  parts.push('</tr>');

  parts.push('</thead>');

  parts.push('<tbody>');


  for (const row of rows) {

    parts.push('<tr>');

    parts.push(
      '<td>' +
      escapeHTML(row.no) +
      '</td>'
    );

    parts.push(
      '<td>' +
      escapeHTML(row.nama) +
      '</td>'
    );

    parts.push(
      '<td>' +
      escapeHTML(row.satuan) +
      '</td>'
    );

    // Zat Aktif
    parts.push('<td></td>');

    // Bentuk
    parts.push('<td></td>');

    parts.push(
      '<td>' +
      escapeHTML(row.jumlah) +
      '</td>'
    );

    parts.push(
      '<td>' +
      escapeHTML(row.keterangan) +
      '</td>'
    );

    parts.push('</tr>');

  }


  parts.push('</tbody>');

  parts.push('</table>');


  return parts.join("");

}
