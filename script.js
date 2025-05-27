// Конфигурация
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzlnU77HvUMHMW41fGuKl1-gQ3k6s_qSzDYQ_t1IlTu85GGHEtMDSP3Gwm2KX5IPMSZ/exec';
const CACHE_TTL = 5 * 60 * 1000; // 5 минут кэширования

let tariffs = [];
let currentResults = [];
let currentCurrency = '';
let lastCacheTime = 0;

document.addEventListener('DOMContentLoaded', function() {
    setupEventListeners();
    loadTariffs();
});

function setupEventListeners() {
    document.getElementById('model').addEventListener('change', function() {
        document.getElementById('longest-side-group').style.display = this.value === 'FBS' ? 'none' : 'block';
    });
    document.getElementById('calculate-btn').addEventListener('click', calculateCosts);
    document.getElementById('export-btn').addEventListener('click', exportToExcel);
}

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
        console.error('Ошибка загрузки тарифов:', error);
    }
}

function calculateCosts() {
    const model = document.getElementById('model').value;
    const country = document.getElementById('country').value;
    const city = document.getElementById('city').value;
    const weight = parseFloat(document.getElementById('weight').value);
    const units = parseInt(document.getElementById('units').value);
    const orders = parseInt(document.getElementById('orders').value);
    const longestSide = model === 'FBO' ? parseFloat(document.getElementById('longest-side').value) : 0;
    const storageDays = parseInt(document.getElementById('storage-days').value) || 0;
    const declaredValue = parseFloat(document.getElementById('declared-value').value) || 0;
    const isExpress = document.getElementById('express').checked;

    currentCurrency = getCurrencyForCountry(country);
    currentResults = [];

    const add = (name, qty, rate, total) => currentResults.push({ name, qty, rate, total });

    const getRate = (type, value) => {
        const match = tariffs.filter(t => t['Тип операции'] === type);
        let rate = 0;
        match.forEach(t => {
            const limitKey = Object.keys(t).find(k => k.toLowerCase().includes('до'));
            const limit = parseFloat(t[limitKey]) || Infinity;
            if (value <= limit) rate = parseFloat(t[getCountryColumn(country)]) || 0;
        });
        return rate;
    };

    const rcp = getRate('Приемка', weight);
    add('Приемка', units, rcp, rcp * units);

    if (model === 'FBO') {
        const prep = getRate('Подготовка FBO', longestSide);
        add('Подготовка FBO', units, prep, prep * units);
    }

    if (storageDays > 0) {
        const store = getRate('Хранение', weight);
        add('Хранение', `${weight} кг × ${storageDays} дн.`, store, store * storageDays);
    }

    const assembly = getRate('Сборка заказа', weight);
    add('Сборка заказа', orders, assembly, assembly * orders);

    if (isExpress) {
        const express = getRate('Экспресс-сборка', orders);
        add('Экспресс-сборка', orders, express, express * orders);
    }

    if (declaredValue > 0) {
        const declared = declaredValue * 0.0001;
        add('Сбор за объявленную стоимость', declaredValue, '0.01%', declared);
    }

    if (model === 'FBS') {
        const delivery = getRate('Доставка FBS', weight);
        add('Доставка FBS', weight, delivery, delivery);
    }

    displayResults();
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
    const map = {
        'Россия': '₽', 'Казахстан': '₸', 'Беларусь': 'Br', 'Китай': '¥',
        'США': '$', 'Армения': '֏', 'Азербайджан': '₼', 'ОАЭ': 'AED',
        'Турция': '₺', 'Испания': '€', 'Кыргызстан': 'с'
    };
    return map[country] || '₽';
}

function displayResults() {
    const table = document.querySelector('#results-table tbody');
    table.innerHTML = '';
    let total = 0;
    currentResults.forEach(r => {
        const row = table.insertRow();
        row.insertCell(0).textContent = r.name;
        row.insertCell(1).textContent = r.qty;
        row.insertCell(2).textContent = typeof r.rate === 'number' ? `${r.rate.toFixed(2)} ${currentCurrency}` : r.rate;
        row.insertCell(3).textContent = `${r.total.toFixed(2)} ${currentCurrency}`;
        total += r.total;
    });
    document.getElementById('total-amount').textContent = total.toFixed(2);
    document.getElementById('currency').textContent = currentCurrency;
}
