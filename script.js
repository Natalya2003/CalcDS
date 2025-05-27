// Конфигурация
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxI2yws5oVFhHajzpGhjIqsWy6IAptuyxV1Tno26-unPgK39Ma5S1gPK2KIp4B7K90W/exec';
const CACHE_TTL = 5 * 60 * 1000; // 5 минут кэширования

// Глобальные переменные
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

// Инициализация при загрузке
document.addEventListener('DOMContentLoaded', function() {
    setupEventListeners();
    loadTariffs();
});

function setupEventListeners() {
    elements.model.addEventListener('change', function() {
        elements.longestSideGroup.style.display = this.value === 'FBS' ? 'none' : 'block';
        this.value === 'FBS' 
            ? elements.longestSide.removeAttribute('required')
            : elements.longestSide.setAttribute('required', '');
    });

    elements.calculateBtn.addEventListener('click', calculateCosts);
    elements.exportBtn.addEventListener('click', exportToExcel);
}

async function loadTariffs() {
    try {
        // Проверка кэша
        const now = Date.now();
        if (now - lastCacheTime < CACHE_TTL && tariffs.length > 0) {
            return;
        }

        showLoading(true);
        
        const response = await fetch(`${APPS_SCRIPT_URL}?action=getTariffs&t=${now}`, {
            method: 'GET',
            cache: 'no-cache'
        });

        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

        const data = await response.json();
        
        if (data.status === 'success' && data.tariffs) {
            tariffs = data.tariffs;
            lastCacheTime = now;
            showLoading(false);
        } else {
            throw new Error(data.message || 'Invalid data format');
        }
    } catch (error) {
        console.error('Ошибка загрузки тарифов:', error);
        elements.loading.innerHTML = `<div class="error">Ошибка: ${error.message}</div>`;
    }
}

function showLoading(show) {
    elements.loading.style.display = show ? 'block' : 'none';
    elements.results.style.display = show ? 'none' : 'block';
}

function calculateCosts() {
    if (!validateInputs()) return;

    const params = getFormParams();
    currentCurrency = getCurrencyForCountry(params.country);
    currentResults = calculateAllCosts(params);

    displayResults();
    saveCalculation(params);
}

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

function validateInputs() {
    const requiredInputs = [
        { el: elements.model, msg: 'Выберите модель' },
        { el: elements.country, msg: 'Выберите страну' },
        { el: elements.city, msg: 'Введите город' },
        { el: elements.weight, msg: 'Введите вес (больше 0)', validate: v => v > 0 },
        { el: elements.units, msg: 'Введите количество единиц (больше 0)', validate: v => v > 0 },
        { el: elements.orders, msg: 'Введите количество заказов (больше 0)', validate: v => v > 0 }
    ];

    if (elements.model.value === 'FBO') {
        requiredInputs.push({ 
            el: elements.longestSide, 
            msg: 'Введите длину самой длинной стороны (больше 0)', 
            validate: v => v > 0 
        });
    }

    let isValid = true;

    requiredInputs.forEach(input => {
        const value = input.el.value;
        let valid = value;
        
        if (input.validate) {
            valid = input.validate(parseFloat(value));
        }

        if (!valid) {
            input.el.style.borderColor = 'red';
            isValid = false;
            if (!document.getElementById(`error-${input.el.id}`)) {
                const errorEl = document.createElement('div');
                errorEl.id = `error-${input.el.id}`;
                errorEl.className = 'error';
                errorEl.textContent = input.msg;
                input.el.parentNode.insertBefore(errorEl, input.el.nextSibling);
            }
        } else {
            input.el.style.borderColor = '#ddd';
            const errorEl = document.getElementById(`error-${input.el.id}`);
            if (errorEl) errorEl.remove();
        }
    });

    return isValid;
}

function calculateAllCosts(params) {
    const results = [];
    const { model, country, weight, units, orders, longestSide, storageDays, declaredValue, isExpress } = params;

    // 1. Приемка
    addOperationResult(results, 'Приемка', weight, calculateOperationCost('Приемка', weight, country));

    // 2. Подготовка товара (FBO)
    if (model === 'FBO') {
        addOperationResult(results, 'Подготовка FBO', units, 
            calculateOperationCost('Подготовка FBO', longestSide, country) * units);
    }

    // 3. Хранение
    if (storageDays > 0) {
        addOperationResult(results, 'Хранение', `${weight} кг × ${storageDays} дн.`, 
            calculateOperationCost('Хранение', weight, country) * storageDays);
    }

    // 4. Сборка заказа
    addOperationResult(results, 'Сборка заказа', orders, 
        calculateOperationCost('Сборка заказа', weight, country) * orders);

    // 5. Экспресс-сборка
    if (isExpress) {
        addOperationResult(results, 'Экспресс-сборка', orders, 
            calculateOperationCost('Экспресс-сборка', orders, country));
    }

    // 6. Сбор за объявленную стоимость
    if (declaredValue > 0) {
        addOperationResult(results, 'Сбор за объявленную стоимость', declaredValue, 
            declaredValue * 0.0001, '0.01%');
    }

    // 7. Доставка (FBS)
    if (model === 'FBS') {
        addOperationResult(results, 'Доставка FBS', weight, 
            calculateOperationCost('Доставка FBS', weight, country));
    }

    return results;
}

function addOperationResult(results, operation, quantity, total, customRate = null) {
    if (total <= 0) return;

    results.push({
        operation,
        quantity: typeof quantity === 'number' ? quantity.toFixed(2) : quantity,
        rate: customRate || (total / (typeof quantity === 'number' ? quantity : 1)).toFixed(2),
        total
    });
}

function calculateOperationCost(operationType, value, country) {
    const operationTariffs = tariffs.filter(t => t['Тип операции'] === operationType);
    if (operationTariffs.length === 0) return 0;

    let applicableTariff = operationTariffs.find(t => {
        const maxValue = parseFloat(t['До ...']) || Infinity;
        return value <= maxValue;
    }) || operationTariffs[operationTariffs.length - 1];

    const countryColumn = getCountryColumn(country);
    return parseFloat(applicableTariff[countryColumn]) || 0;
}

function getCountryColumn(country) {
    const countryColumns = {
        'Россия': 'Рубль (Россия)',
        'Казахстан': 'Тенге (Казахстан)',
        'Беларусь': 'Бел. рубль (Беларусь)',
        'Китай': 'Юань (Китай)',
        'США': 'Доллар (США)',
        'Армения': 'Драм (Армения)',
        'Азербайджан': 'Манат (Азербайджан)',
        'ОАЭ': 'Дирхам (ОАЭ)',
        'Турция': 'Лира (Турция)',
        'Испания': 'Евро (Испания)',
        'Кыргызстан': 'Сом (Кыргызстан)'
    };
    
    return countryColumns[country] || 'Рубль (Россия)';
}

function getCurrencyForCountry(country) {
    const currencies = {
        'Россия': '₽',
        'Казахстан': '₸',
        'Беларусь': 'Br',
        'Китай': '¥',
        'США': '$',
        'Армения': '֏',
        'Азербайджан': '₼',
        'ОАЭ': 'AED',
        'Турция': '₺',
        'Испания': '€',
        'Кыргызстан': 'с'
    };
    
    return currencies[country] || '₽';
}

function displayResults() {
    elements.resultsTable.innerHTML = '';
    let total = 0;

    currentResults.forEach(item => {
        const row = elements.resultsTable.insertRow();
        
        row.insertCell(0).textContent = item.operation;
        row.insertCell(1).textContent = item.quantity;
        row.insertCell(2).textContent = typeof item.rate === 'string' 
            ? item.rate 
            : `${item.rate} ${currentCurrency}`;
        
        const totalCell = row.insertCell(3);
        totalCell.textContent = `${item.total.toFixed(2)} ${currentCurrency}`;
        totalCell.classList.add('total-cell');
        
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
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                action: 'saveCalculation',
                data: {
                    ...params,
                    total: parseFloat(total.toFixed(2)),
                    date: new Date().toISOString()
                }
            })
        });

        if (!response.ok) throw new Error('Ошибка сохранения');
        
        const result = await response.json();
        if (result.status !== 'success') {
            console.warn('Не удалось сохранить расчет:', result.message);
        }
    } catch (error) {
        console.error('Ошибка при сохранении расчета:', error);
    }
}

function exportToExcel() {
    if (currentResults.length === 0) return;

    const exportData = [
        ['Тип операции', 'Количество', 'Тариф', 'Итого'],
        ...currentResults.map(item => [
            item.operation,
            item.quantity,
            typeof item.rate === 'string' ? item.rate : `${item.rate} ${currentCurrency}`,
            `${item.total.toFixed(2)} ${currentCurrency}`
        ]),
        ['', '', 'Общая сумма:', `${elements.totalAmount.textContent} ${currentCurrency}`]
    ];

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(exportData);
    XLSX.utils.book_append_sheet(wb, ws, 'Расчет фулфилмента');

    const date = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `Расчет фулфилмента ${date}.xlsx`);
}
