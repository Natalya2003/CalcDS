// Конфигурация Google Sheets
const SPREADSHEET_ID = 'YOUR_GOOGLE_SHEET_ID';
const API_KEY = 'YOUR_GOOGLE_API_KEY';
const SHEET_NAME = 'Тарифы';

// Глобальные переменные
let tariffs = [];
let currentResults = [];
let currentCurrency = '';

// DOM элементы
const modelSelect = document.getElementById('model');
const countrySelect = document.getElementById('country');
const cityInput = document.getElementById('city');
const weightInput = document.getElementById('weight');
const unitsInput = document.getElementById('units');
const ordersInput = document.getElementById('orders');
const longestSideInput = document.getElementById('longest-side');
const storageDaysInput = document.getElementById('storage-days');
const declaredValueInput = document.getElementById('declared-value');
const expressCheckbox = document.getElementById('express');
const calculateBtn = document.getElementById('calculate-btn');
const exportBtn = document.getElementById('export-btn');
const resultsTable = document.getElementById('results-table').getElementsByTagName('tbody')[0];
const totalAmountSpan = document.getElementById('total-amount');
const currencySpan = document.getElementById('currency');
const loadingDiv = document.getElementById('loading');
const resultsDiv = document.getElementById('results');
const longestSideGroup = document.getElementById('longest-side-group');

// Инициализация при загрузке
document.addEventListener('DOMContentLoaded', function() {
    // Загружаем тарифы при загрузке страницы
    loadTariffs();
    
    // Скрываем поле "Самая длинная сторона" для FBS
    modelSelect.addEventListener('change', function() {
        if (this.value === 'FBS') {
            longestSideGroup.style.display = 'none';
            longestSideInput.removeAttribute('required');
        } else {
            longestSideGroup.style.display = 'block';
            longestSideInput.setAttribute('required', '');
        }
    });
    
    // Обработчик кнопки расчета
    calculateBtn.addEventListener('click', calculateCosts);
    
    // Обработчик кнопки экспорта
    exportBtn.addEventListener('click', exportToExcel);
});

// Загрузка тарифов из Google Sheets
async function loadTariffs() {
    try {
        loadingDiv.style.display = 'block';
        resultsDiv.style.display = 'none';
        
        const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${SHEET_NAME}?key=${API_KEY}`);
        const data = await response.json();
        
        if (data.values && data.values.length > 1) {
            // Преобразуем данные в массив объектов
            const headers = data.values[0];
            tariffs = data.values.slice(1).map(row => {
                const obj = {};
                headers.forEach((header, i) => {
                    obj[header] = row[i];
                });
                return obj;
            });
            
            loadingDiv.style.display = 'none';
            resultsDiv.style.display = 'block';
            console.log('Тарифы загружены:', tariffs);
        } else {
            throw new Error('Нет данных в таблице');
        }
    } catch (error) {
        console.error('Ошибка загрузки тарифов:', error);
        loadingDiv.innerHTML = `<div class="error">Ошибка загрузки тарифов: ${error.message}</div>`;
    }
}

// Основная функция расчета
function calculateCosts() {
    // Валидация полей
    if (!validateInputs()) return;
    
    const model = modelSelect.value;
    const country = countrySelect.value;
    const weight = parseFloat(weightInput.value);
    const units = parseInt(unitsInput.value);
    const orders = parseInt(ordersInput.value);
    const longestSide = model === 'FBO' ? parseInt(longestSideInput.value) : 0;
    const storageDays = parseInt(storageDaysInput.value) || 0;
    const declaredValue = parseFloat(declaredValueInput.value) || 0;
    const isExpress = expressCheckbox.checked;
    
    // Определяем валюту для страны
    currentCurrency = getCurrencyForCountry(country);
    
    // Рассчитываем стоимость для каждого этапа
    currentResults = [];
    
    // 1. Приемка (по весу)
    const acceptanceCost = calculateOperationCost('Приемка', weight, country);
    if (acceptanceCost > 0) {
        currentResults.push({
            operation: 'Приемка',
            quantity: weight.toFixed(2) + ' кг',
            rate: acceptanceCost / weight,
            total: acceptanceCost
        });
    }
    
    // 2. Подготовка товара (FBO) (по габаритам)
    if (model === 'FBO') {
        const preparationCost = calculateOperationCost('Подготовка FBO', longestSide, country) * units;
        if (preparationCost > 0) {
            currentResults.push({
                operation: 'Подготовка FBO',
                quantity: units,
                rate: preparationCost / units,
                total: preparationCost
            });
        }
    }
    
    // 3. Хранение (по весу и количеству дней)
    if (storageDays > 0) {
        const storageCost = calculateOperationCost('Хранение', weight, country) * storageDays;
        if (storageCost > 0) {
            currentResults.push({
                operation: 'Хранение',
                quantity: `${weight.toFixed(2)} кг × ${storageDays} дн.`,
                rate: calculateOperationCost('Хранение', weight, country),
                total: storageCost
            });
        }
    }
    
    // 4. Сборка заказа (учитывает количество заказов и вес)
    const assemblyCost = calculateOperationCost('Сборка заказа', weight, country) * orders;
    if (assemblyCost > 0) {
        currentResults.push({
            operation: 'Сборка заказа',
            quantity: orders,
            rate: calculateOperationCost('Сборка заказа', weight, country),
            total: assemblyCost
        });
    }
    
    // 5. Экспресс-сборка (по отдельной логике)
    if (isExpress) {
        const expressCost = calculateOperationCost('Экспресс-сборка', orders, country);
        if (expressCost > 0) {
            currentResults.push({
                operation: 'Экспресс-сборка',
                quantity: orders,
                rate: expressCost / orders,
                total: expressCost
            });
        }
    }
    
    // 6. Сбор за объявленную стоимость (0.01% от суммы)
    if (declaredValue > 0) {
        const declaredValueCost = declaredValue * 0.0001; // 0.01%
        currentResults.push({
            operation: 'Сбор за объявленную стоимость',
            quantity: declaredValue.toFixed(2),
            rate: '0.01%',
            total: declaredValueCost
        });
    }
    
    // 7. Доставка (FBS) (по весу)
    if (model === 'FBS') {
        const deliveryCost = calculateOperationCost('Доставка FBS', weight, country);
        if (deliveryCost > 0) {
            currentResults.push({
                operation: 'Доставка FBS',
                quantity: weight.toFixed(2) + ' кг',
                rate: deliveryCost / weight,
                total: deliveryCost
            });
        }
    }
    
    // Отображаем результаты
    displayResults();
}

// Валидация ввода
function validateInputs() {
    let isValid = true;
    
    // Проверяем обязательные поля
    const requiredInputs = [
        modelSelect, countrySelect, cityInput, 
        weightInput, unitsInput, ordersInput
    ];
    
    if (modelSelect.value === 'FBO') {
        requiredInputs.push(longestSideInput);
    }
    
    requiredInputs.forEach(input => {
        if (!input.value) {
            input.style.borderColor = 'red';
            isValid = false;
        } else {
            input.style.borderColor = '#ddd';
        }
    });
    
    if (!isValid) {
        alert('Пожалуйста, заполните все обязательные поля (отмечены *)');
        return false;
    }
    
    // Проверяем числовые значения
    if (parseFloat(weightInput.value) <= 0) {
        alert('Вес должен быть больше 0');
        weightInput.style.borderColor = 'red';
        return false;
    }
    
    if (parseInt(unitsInput.value) <= 0) {
        alert('Количество единиц должно быть больше 0');
        unitsInput.style.borderColor = 'red';
        return false;
    }
    
    if (parseInt(ordersInput.value) <= 0) {
        alert('Количество заказов должно быть больше 0');
        ordersInput.style.borderColor = 'red';
        return false;
    }
    
    return true;
}

// Расчет стоимости операции
function calculateOperationCost(operationType, value, country) {
    // Находим все тарифы для данной операции
    const operationTariffs = tariffs.filter(t => t['Тип операции'] === operationType);
    
    if (operationTariffs.length === 0) {
        console.warn(`Не найдены тарифы для операции: ${operationType}`);
        return 0;
    }
    
    // Находим подходящий тариф на основе значения
    let applicableTariff = null;
    
    for (const tariff of operationTariffs) {
        const maxValue = parseFloat(tariff['До ...']) || Infinity;
        
        if (value <= maxValue) {
            applicableTariff = tariff;
            break;
        }
    }
    
    // Если не нашли подходящий тариф, берем последний (самый большой)
    if (!applicableTariff) {
        applicableTariff = operationTariffs[operationTariffs.length - 1];
    }
    
    // Получаем стоимость для выбранной страны
    const countryColumn = getCountryColumn(country);
    const cost = parseFloat(applicableTariff[countryColumn]) || 0;
    
    return cost;
}

// Получение названия колонки для страны
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

// Получение валюты для страны
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

// Отображение результатов
function displayResults() {
    // Очищаем таблицу
    resultsTable.innerHTML = '';
    
    let total = 0;
    
    // Заполняем таблицу результатами
    currentResults.forEach(item => {
        const row = resultsTable.insertRow();
        
        const cell1 = row.insertCell(0);
        const cell2 = row.insertCell(1);
        const cell3 = row.insertCell(2);
        const cell4 = row.insertCell(3);
        
        cell1.textContent = item.operation;
        cell2.textContent = item.quantity;
        
        if (typeof item.rate === 'number') {
            cell3.textContent = item.rate.toFixed(2) + ' ' + currentCurrency;
        } else {
            cell3.textContent = item.rate;
        }
        
        cell4.textContent = item.total.toFixed(2) + ' ' + currentCurrency;
        
        total += item.total;
    });
    
    // Отображаем общую сумму
    totalAmountSpan.textContent = total.toFixed(2);
    currencySpan.textContent = currentCurrency;
    
    // Активируем кнопку экспорта
    exportBtn.disabled = false;
}

// Экспорт в Excel
function exportToExcel() {
    if (currentResults.length === 0) return;
    
    // Создаем данные для экспорта
    const exportData = [
        ['Тип операции', 'Количество', 'Тариф', 'Итого'],
        ...currentResults.map(item => [
            item.operation,
            item.quantity,
            typeof item.rate === 'number' ? item.rate.toFixed(2) + ' ' + currentCurrency : item.rate,
            item.total.toFixed(2) + ' ' + currentCurrency
        ]),
        ['', '', 'Общая сумма:', totalAmountSpan.textContent + ' ' + currentCurrency]
    ];
    
    // Создаем книгу Excel
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(exportData);
    XLSX.utils.book_append_sheet(wb, ws, 'Расчет фулфилмента');
    
    // Генерируем файл
    const date = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `Расчет фулфилмента ${date}.xlsx`);
}
