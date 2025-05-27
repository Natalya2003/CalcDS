// Конфигурация
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwnrvrPljaH0yNPrQPgqlxxx0jS6ySRUM6PaAIlpX7Ffd3o5IZMOUlzEdSZ-TTwCEDP/exec';
const CACHE_TTL = 5 * 60 * 1000;

let tariffs = [];
let lastCacheTime = 0;
let currentCurrency = '';

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('calculate-btn').addEventListener('click', calculateCosts);
  document.getElementById('export-btn').addEventListener('click', exportToExcel);
  loadTariffs();
});

async function loadTariffs() {
  try {
    const now = Date.now();
    if (now - lastCacheTime < CACHE_TTL && tariffs.length > 0) return;
    const response = await fetch(`${APPS_SCRIPT_URL}?action=getTariffs&t=${now}`);
    const data = await response.json();
    if (data.status === 'success' && data.tariffs) {
      tariffs = data.tariffs;
      lastCacheTime = now;
    } else {
      throw new Error(data.message || 'Invalid data format');
    }
  } catch (error) {
    alert(`Ошибка загрузки тарифов: ${error.message}`);
  }
}

function calculateCosts() {
  const model = document.getElementById('model').value;
  const country = document.getElementById('country').value;
  const city = document.getElementById('city').value;
  const weight = parseFloat(document.getElementById('weight').value);
  const units = parseInt(document.getElementById('units').value);
  const orders = parseInt(document.getElementById('orders').value);
  const length = model === 'FBO' ? parseFloat(document.getElementById('longest-side').value) : 0;
  const days = parseInt(document.getElementById('storage-days').value) || 0;
  const value = parseFloat(document.getElementById('declared-value').value) || 0;
  const express = document.getElementById('express').checked;

  currentCurrency = getCurrency(country);
  const results = [];
  let total = 0;

  const rcp = getRate('Приемка', weight, country);
  if (rcp) { results.push(['Приемка', units, `${rcp} ${currentCurrency}`, (rcp * units).toFixed(2) + ` ${currentCurrency}`]); total += rcp * units; }

  if (model === 'FBO') {
    const prep = getRate('Подготовка FBO', length, country);
    if (prep) { results.push(['Подготовка FBO', units, `${prep} ${currentCurrency}`, (prep * units).toFixed(2) + ` ${currentCurrency}`]); total += prep * units; }
  }

  if (days > 0) {
    const store = getRate('Хранение', weight, country);
    if (store) { results.push(['Хранение', `${weight} кг × ${days} дн.`, `${store} ${currentCurrency}`, (store * days).toFixed(2) + ` ${currentCurrency}`]); total += store * days; }
  }

  const assembly = city.match(/Москва|Санкт-Петербург/i) ? 120 : 80;
  const extra = weight > 5 ? (weight - 5) * 13 : 0;
  const assm = express ? 240 + (units - 1) * 26 : assembly + extra;
  results.push([express ? 'Экспресс-сборка' : 'Сборка заказа', orders, `${assm} ${currentCurrency}`, (assm * orders).toFixed(2) + ` ${currentCurrency}`]);
  total += assm * orders;

  if (value > 0) {
    const valFee = +(value * 0.0001).toFixed(2);
    results.push(['Сбор за объявленную стоимость', value, '0.01%', `${valFee} ${currentCurrency}`]);
    total += valFee;
  }

  if (model === 'FBS') {
    const deliv = getRate('Доставка FBS', weight, country);
    if (deliv) { results.push(['Доставка FBS', weight, `${deliv} ${currentCurrency}`, deliv.toFixed(2) + ` ${currentCurrency}`]); total += deliv; }
  }

  renderResults(results, total);
}

function getRate(type, value, country) {
  const rates = tariffs.filter(t => t['Тип операции'] === type);
  for (const r of rates) {
    const max = parseFloat(r['До ...']) || Infinity;
    if (value <= max) return parseFloat(r[getColumn(country)]) || 0;
  }
  return rates.length ? parseFloat(rates[rates.length - 1][getColumn(country)]) || 0 : 0;
}

function getColumn(country) {
  const map = { 'Россия': 'Рубль (Россия)', 'Казахстан': 'Тенге (Казахстан)', 'Беларусь': 'Белорусский рубль (Беларусь)', 'Китай': 'Юань (Китай)', 'США': 'Доллар (США)', 'Армения': 'Драм (Армения)', 'Азербайджан': 'Манат (Азербайджан)', 'ОАЭ': 'Дирхам (ОАЭ)', 'Турция': 'Лира (Турция)', 'Испания': 'Евро (Испания)', 'Кыргызстан': 'Сом (Кыргызстан)' };
  return map[country] || 'Рубль (Россия)';
}

function getCurrency(country) {
  const map = { 'Россия': '₽', 'Казахстан': '₸', 'Беларусь': 'Br', 'Китай': '¥', 'США': '$', 'Армения': '֏', 'Азербайджан': '₼', 'ОАЭ': 'AED', 'Турция': '₺', 'Испания': '€', 'Кыргызстан': 'с' };
  return map[country] || '₽';
}

function renderResults(data, total) {
  const tbody = document.getElementById('results-table').querySelector('tbody');
  tbody.innerHTML = '';
  data.forEach(row => {
    const tr = tbody.insertRow();
    row.forEach(cell => tr.insertCell().innerHTML = cell);
  });
  document.getElementById('total-amount').innerText = total.toFixed(2);
  document.getElementById('currency').innerText = currentCurrency;
  document.getElementById('export-btn').disabled = false;
}

function exportToExcel() {
  const rows = [['Тип операции', 'Количество', 'Тариф', 'Итого']];
  const table = document.getElementById('results-table').querySelectorAll('tbody tr');
  table.forEach(tr => rows.push([...tr.cells].map(td => td.innerText)));
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, 'Расчет');
  XLSX.writeFile(wb, 'Расчет фулфилмента.xlsx');
}
