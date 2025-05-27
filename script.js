// Конфигурация
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzlnU77HvUMHMW41fGuKl1-gQ3k6s_qSzDYQ_t1IlTu85GGHEtMDSP3Gwm2KX5IPMSZ/exec';
const CACHE_TTL = 5 * 60 * 1000;

let tariffs = [];
let currentResults = [];
let currentCurrency = '';
let lastCacheTime = 0;

// DOM элементы
const elements = {
    model: document.getElementById('model'),
    country: document.getElementById('country'),
    city: document.getElementById('city'),
    weight: document.getElementById('weight'),
    units: document.getElementById('units'),
    orders: document.getElementById('orders'),
    longestSide: document.getElementById('longest-side'),
    storageDays: document.getElementById('storage-days'),
    declaredValue: document.getElementById('declared-value'),
    express: document.getElementById('express'),
    calculateBtn: document.getElementById('calculate-btn'),
    exportBtn: document.getElementById('export-btn'),
    resultsTable: document.getElementById('results-table').getElementsByTagName('tbody')[0],
    totalAmount: document.getElementById('total-amount'),
    currency: document.getElementById('currency'),
    loading: document.getElementById('loading'),
    results: document.getElementById('results'),
    longestSideGroup: document.getElementById('longest-side-group')
};

// Инициализация
document.addEventListener('DOMContentLoaded', function() {
    elements.model.addEventListener('change', function() {
        elements.longestSideGroup.style.display = this.value === 'FBS' ? 'none' : 'block';
        this.value === 'FBS' ? elements.longestSide.removeAttribute('required') : elements.longestSide.setAttribute('required', '');
    });

    elements.calculateBtn.addEventListener('click', calculateCosts);
    elements.exportBtn.addEventListener('click', exportToExcel);
    loadTariffs();
});

// Загрузка тарифов
async function loadTariffs() {
    try {
        const now = Date.now();
        if (now - lastCacheTime < CACHE_TTL && tariffs.length > 0) {
            showLoading(false);
            return;
        }

        showLoading(true);

        const response = await fetch(`${APPS_SCRIPT_URL}?action=getTariffs&t=${now}`, { method: 'GET', cache: 'no-cache' });
        const data = await response.json();

        if (data.status === 'success' && data.tariffs) {
            tariffs = data.tariffs;
            lastCacheTime = now;
        } else {
            throw new Error(data.message || 'Invalid data format');
        }

    } catch (error) {
        console.error('Ошибка загрузки тарифов:', error);
        elements.loading.innerHTML = `<div class="error">Ошибка: ${error.message}</div>`;
    } finally {
        showLoading(false);
    }
}

function showLoading(show) {
    elements.loading.style.display = show ? 'block' : 'none';
    elements.results.style.display = show ? 'none' : 'block';
}

// Основной расчет
function calculateCosts() {
    if (!validateInputs()) return;

    const params = getFormParams();
    currentCurrency = getCurrencyForCountry(params.country);
    currentResults = calculateAllCosts(params);

    displayResults();
    saveCalculation(params);
}

// Форма
function getFormParams() {
    return {
        model: elements.model.value,
        country: elements.country.value,
        city: elements.city.value,
        weight: parseFloat(elements.weight.value),
        units: parseInt(elements.units.value),
        orders: parseInt(elements.orders.value),
        longestSide: elements.model.value === 'FBO' ? parseInt(elements.longestSide.value) : 0,
        storageDays: parseInt(elements.storageDays.value) || 0,
        declaredValue: parseFloat(elements.declaredValue.value) || 0,
        isExpress: elements.express.checked
    };
}

// Проверка полей
function validateInputs() {
    let isValid = true;
    const inputs = [
        { el: elements.model, msg: 'Выберите модель' },
        { el: elements.country, msg: 'Выберите страну' },
        { el: elements.city, msg: 'Введите город' },
        { el: elements.weight, msg: 'Введите вес', validate: v => v > 0 },
        { el: elements.units, msg: 'Введите количество единиц', validate: v => v > 0 },
        { el: elements.orders, msg: 'Введите количество заказов', validate: v => v > 0 }
    ];

    if (elements.model.value === 'FBO') {
        inputs.push({ el: elements.longestSide, msg: 'Введите длину самой длинной стороны', validate: v => v > 0 });
    }

    inputs.forEach(input => {
        const value = input.el.value;
        const valid = input.validate ? input.validate(parseFloat(value)) : !!value;
        input.el.style.borderColor = valid ? '#ddd' : 'red';
        isValid = isValid && valid;
    });

    return isValid;
}

// Расчет по этапам
function calculateAllCosts(params) {
    const results = [];
    const { model, country, weight, units, orders, longestSide, storageDays, declaredValue, isExpress } = params;

    addResult(results, 'Приемка', weight, calculateOperationCost('Приемка', weight, country));
    if (model === 'FBO') addResult(results, 'Подготовка FBO', units, calculateOperationCost('Подготовка FBO', longestSide, country) * units);
    if (storageDays > 0) addResult(results, 'Хранение', `${weight} кг × ${storageDays} дн.`, calculateOperationCost('Хранение', weight, country) * storageDays);
    addResult(results, 'Сборка заказа', orders, calculateOperationCost('Сборка заказа', weight, country) * orders);
    if (isExpress) addResult(results, 'Экспресс-сборка', orders, calculateOperationCost('Экспресс-сборка', orders, country));
    if (declaredValue > 0) addResult(results, 'Сбор за объявленную стоимость', declaredValue, declaredValue * 0.0001, '0.01%');
    if (model === 'FBS') addResult(results, 'Доставка FBS', weight, calculateOperationCost('Доставка FBS', weight, country));

    return results;
}

function addResult(results, operation, quantity, total, customRate = null) {
    if (total <= 0) return;
    results.push({
        operation,
        quantity: typeof quantity === 'number' ? quantity.toFixed(2) : quantity,
        rate: customRate || (total / (typeof quantity === 'number' ? quantity : 1)).toFixed(2),
        total
    });
}

function calculateOperationCost(type, value, country) {
    const rows = tariffs.filter(t => t['Тип операции'] === type);
    if (rows.length === 0) return 0;
    const tariff = rows.find(t => value <= parseFloat(t['До ...'])) || rows[rows.length - 1];
    return parseFloat(tariff[getCountryColumn(country)]) || 0;
}

function getCountryColumn(country) {
    const map = {
        'Россия': 'Рубль (Россия)', 'Казахстан': 'Тенге (Казахстан)', 'Беларусь': 'Бел. рубль (Беларусь)',
        'Китай': 'Юань (Китай)', 'США': 'Доллар (США)', 'Армения': 'Драм (Армения)',
        'Азербайджан': 'Манат (Азербайджан)', 'ОАЭ': 'Дирхам (ОАЭ)', 'Турция': 'Лира (Турция)',
        'Испания': 'Евро (Испания)', 'Кыргызстан': 'Сом (Кыргызстан)'
    };
    return map[country] || 'Рубль (Россия)';
}

function getCurrencyForCountry(country) {
    const map = { 'Россия': '₽', 'Казахстан': '₸', 'Беларусь': 'Br', 'Китай': '¥', 'США': '$', 'Армения': '֏', 'Азербайджан': '₼', 'ОАЭ': 'AED', 'Турция': '₺', 'Испания': '€', 'Кыргызстан': 'с' };
    return map[country] || '₽';
}

function displayResults() {
    elements.resultsTable.innerHTML = '';
    let total = 0;
    currentResults.forEach(item => {
        const row = elements.resultsTable.insertRow();
        row.insertCell(0).textContent = item.operation;
        row.insertCell(1).textContent = item.quantity;
        row.insertCell(2).textContent = typeof item.rate === 'string' ? item.rate : `${item.rate} ${currentCurrency}`;
        row.insertCell(3).textContent = `${item.total.toFixed(2)} ${currentCurrency}`;
        total += item.total;
    });
    elements.totalAmount.textContent = total.toFixed(2);
    elements.currency.textContent = currentCurrency;
    elements.exportBtn.disabled = false;
}

async function saveCalculation(params) {
    try {
        const total = currentResults.reduce((sum, item) => sum + item.total, 0);
        const response = await fetch(APPS_SCRIPT_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'saveCalculation', data: { ...params, total: parseFloat(total.toFixed(2)), date: new Date().toISOString() } })
        });
        if (!response.ok) throw new Error('Ошибка сохранения');
        const result = await response.json();
        if (result.status !== 'success') console.warn('Не удалось сохранить расчет:', result.message);
    } catch (error) {
        console.error('Ошибка при сохранении расчета:', error);
    }
}

function exportToExcel() {
    if (currentResults.length === 0) return;
    const exportData = [['Тип операции', 'Количество', 'Тариф', 'Итого'], ...currentResults.map(i => [i.operation, i.quantity, typeof i.rate === 'string' ? i.rate : `${i.rate} ${currentCurrency}`, `${i.total.toFixed(2)} ${currentCurrency}`]), ['', '', 'Общая сумма:', `${elements.totalAmount.textContent} ${currentCurrency}`]];
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(exportData);
    XLSX.utils.book_append_sheet(wb, ws, 'Расчет фулфилмента');
    XLSX.writeFile(wb, `Расчет фулфилмента ${new Date().toISOString().slice(0,10)}.xlsx`);
}
