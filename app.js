import { GoogleGenerativeAI } from "@google/generative-ai";
import { initializeApp } from "firebase/app";
import { getFirestore, collection, addDoc, serverTimestamp, query, where, orderBy, limit, getDocs } from "firebase/firestore";

// ==========================================
// 1. CẤU HÌNH API KEYS (Cần điền thông tin thật của anh)
// ==========================================
const GEMINI_API_KEY = "AIzaSyCcA6BxhiMPJfJ_G3OLg0cs7zJ_afPELG8";

const firebaseConfig = {
  apiKey: "AIzaSyBkiFF_f1PexwftBRdMwZrUCUj6cC4w_GA",
  authDomain: "thlong-vehicle-cost.firebaseapp.com",
  projectId: "thlong-vehicle-cost",
  storageBucket: "thlong-vehicle-cost.firebasestorage.app",
  messagingSenderId: "171162332982",
  appId: "1:171162332982:web:585cfd60679ef179fbcd97"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

let chartInstance = null;

// ==========================================
// 2. LOGIC UI: Ẩn/Hiện ô nhập Số Lít
// ==========================================
document.getElementById('expenseType').addEventListener('change', (e) => {
    const volContainer = document.getElementById('volumeContainer');
    if(e.target.value === "Xăng") {
        volContainer.style.display = "block";
    } else {
        volContainer.style.display = "none";
        document.getElementById('volume').value = "";
    }
});

// ==========================================
// 3. LOGIC AI: Đọc ảnh Odometer
// ==========================================
document.getElementById('btnReadImage').addEventListener('click', async () => {
    const fileInput = document.getElementById('odometerImage');
    const statusText = document.getElementById('aiStatus');
    const odometerInput = document.getElementById('odometerValue');

    if (fileInput.files.length === 0) {
        alert("Anh vui lòng chụp hoặc chọn ảnh Odometer trước nhé!");
        return;
    }

    statusText.innerText = "⏳ Đang gửi ảnh cho Gemini xử lý...";
    statusText.className = "form-text text-primary mt-1 fw-bold";
    const file = fileInput.files[0];

    try {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = async () => {
            const base64Data = reader.result.split(',')[1];
            const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
            
            const prompt = "Đây là ảnh chụp đồng hồ công-tơ-mét. Hãy trích xuất con số chỉ quãng đường (odometer). CHỈ TRẢ VỀ CÁC CHỮ SỐ, KHÔNG KÈM CHỮ CÁI, KHÔNG DẤU CHẤM PHẨY. Nếu mờ không đọc được, trả về ERROR.";
            
            const imagePart = { inlineData: { data: base64Data, mimeType: file.type } };
            const result = await model.generateContent([prompt, imagePart]);
            const textResult = result.response.text().trim();

            if (textResult === "ERROR" || isNaN(textResult) || textResult === "") {
                statusText.innerText = "❌ Ảnh mờ hoặc AI không nhận diện được. Anh vui lòng nhập tay.";
                statusText.className = "form-text text-danger mt-1 fw-bold";
            } else {
                odometerInput.value = textResult;
                statusText.innerText = "✅ Đã đọc thành công!";
                statusText.className = "form-text text-success mt-1 fw-bold";
            }
        };
    } catch (error) {
        console.error("Lỗi AI:", error);
        statusText.innerText = "❌ Lỗi kết nối AI.";
    }
});

// ==========================================
// 4. LOGIC TRUY VẤN DỮ LIỆU CUỐI CÙNG
// ==========================================
async function getLastRecord(vehicleId, type) {
    const expensesRef = collection(db, "expenses");
    const q = query(
        expensesRef,
        where("vehicle_id", "==", vehicleId),
        where("type", "==", type),
        orderBy("created_at", "desc"),
        limit(1)
    );
    try {
        const snapshot = await getDocs(q);
        if (!snapshot.empty) {
            return snapshot.docs[0].data();
        }
    } catch (e) {
        console.error("Lỗi Query (Có thể thiếu Index):", e);
    }
    return null;
}

// ==========================================
// 5. TIÊN ĐOÁN NGÀY HẾT XĂNG
// ==========================================
async function checkPredictions(vehicleId) {
    const alertBox = document.getElementById('predictionAlert');
    alertBox.classList.add('d-none'); // Ẩn mặc định

    const lastFuel = await getLastRecord(vehicleId, "Xăng");
    
    // Nếu có dữ liệu chu kỳ
    if (lastFuel && lastFuel.days_cycle > 0 && lastFuel.created_at) {
        const lastDate = lastFuel.created_at.toDate();
        const now = new Date();
        const daysPassed = (now - lastDate) / (1000 * 3600 * 24);
        
        // Theo thuật toán: Cảnh báo trước 1 ngày so với chu kỳ cũ
        if (daysPassed >= (lastFuel.days_cycle - 1)) {
            alertBox.classList.remove('d-none');
            alertBox.innerHTML = `🚨 <strong>Gợi ý:</strong> Theo thói quen, có thể ngày mai xe <strong>${vehicleId}</strong> sẽ cần đổ xăng đấy!`;
        }
    }
}

// ==========================================
// 6. XỬ LÝ LƯU DỮ LIỆU VÀ SO SÁNH
// ==========================================
document.getElementById('btnSave').addEventListener('click', async () => {
    const btn = document.getElementById('btnSave');
    const vehicleId = document.getElementById('vehicleId').value;
    const type = document.getElementById('expenseType').value;
    const amount = Number(document.getElementById('amount').value);
    const volume = Number(document.getElementById('volume').value);
    const currentOdo = Number(document.getElementById('odometerValue').value);

    if (!amount || !currentOdo || (type === "Xăng" && !volume)) {
        alert("Vui lòng nhập đủ các trường dữ liệu yêu cầu!");
        return;
    }

    btn.disabled = true;
    btn.innerText = "⏳ Đang xử lý...";

    let kmPerLiter = 0;
    let daysCycle = 0;
    let alertMessage = "✅ Đã lưu dữ liệu thành công!";
    const now = new Date();

    // 6.1 Logic cho XĂNG
    if (type === "Xăng") {
        const lastFuel = await getLastRecord(vehicleId, "Xăng");
        
        if (lastFuel && lastFuel.odometer && lastFuel.volume) {
            // Quãng đường đi được TỪ LẦN ĐỔ TRƯỚC
            const distance = currentOdo - lastFuel.odometer;
            
            // Số ngày trôi qua TỪ LẦN ĐỔ TRƯỚC
            if (lastFuel.created_at) {
                const lastDate = lastFuel.created_at.toDate();
                daysCycle = (now - lastDate) / (1000 * 3600 * 24); 
            }
            
            if (distance > 0) {
                // Hiệu suất: km đi được / số lít CỦA LẦN TRƯỚC
                kmPerLiter = distance / lastFuel.volume; 
                
                if (lastFuel.km_per_liter) {
                    // Cảnh báo nếu hiệu suất giảm mạnh (VD: giảm 10% tức là hao xăng hơn)
                    if (kmPerLiter < lastFuel.km_per_liter * 0.9) {
                        alertMessage = `⚠️ HAO XĂNG HƠN TRƯỚC!\nĐợt này chỉ đạt ${kmPerLiter.toFixed(2)} km/lít (Cũ: ${lastFuel.km_per_liter.toFixed(2)} km/lít).`;
                    } else {
                        alertMessage = `✅ Mức tiêu thụ ổn định: ${kmPerLiter.toFixed(2)} km/lít.`;
                    }
                } else {
                    alertMessage = `✅ Đã ghi nhận mốc tiêu thụ đầu tiên: ${kmPerLiter.toFixed(2)} km/lít.`;
                }
            } else {
                 alertMessage = "Lưu thành công. (Chưa đi thêm được km nào).";
            }
        } else {
            alertMessage = "Lưu thành công mốc Xăng đầu tiên. Lần đổ sau hệ thống sẽ bắt đầu tính toán.";
        }
    }

    // 6.2 Logic kiểm tra NHỚT (Check độc lập mỗi khi có nhập Odo)
    const lastOil = await getLastRecord(vehicleId, "Nhớt máy");
    if (lastOil && currentOdo) {
        if (currentOdo - lastOil.odometer >= 3500) {
            alertMessage += `\n\n🚨 CẢNH BÁO NHỚT: Đã chạy ${currentOdo - lastOil.odometer} km kể từ lần thay cuối. Khuyến nghị thay nhớt ngay!`;
        }
    }

    // Gói dữ liệu
    const dataToSave = {
        vehicle_id: vehicleId,
        type: type,
        amount: amount,
        volume: volume || 0, // Nếu không phải xăng thì volume = 0
        odometer: currentOdo,
        km_per_liter: kmPerLiter, 
        days_cycle: daysCycle,    
        created_at: serverTimestamp()
    };

    try {
        await addDoc(collection(db, "expenses"), dataToSave);
        alert(alertMessage);
        
        // Reset form
        document.getElementById('amount').value = '';
        if(type === "Xăng") document.getElementById('volume').value = '';
        document.getElementById('odometerValue').value = '';
        document.getElementById('odometerImage').value = '';
        document.getElementById('aiStatus').innerText = '';
        
        // Cập nhật lại biểu đồ và dự đoán
        loadChart(vehicleId);
        setTimeout(() => checkPredictions(vehicleId), 1000); // Đợi 1s để DB kịp ghi timestamp

    } catch (error) {
        console.error("Lỗi:", error);
        alert("Có lỗi xảy ra khi lưu!");
    } finally {
        btn.disabled = false;
        btn.innerText = "💾 LƯU DỮ LIỆU";
    }
});

// ==========================================
// 7. VẼ BIỂU ĐỒ (CHART.JS)
// ==========================================
async function loadChart(vehicleId) {
    const expensesRef = collection(db, "expenses");
    // Chỉ lấy các mốc Xăng tính được hiệu suất > 0
    const q = query(
        expensesRef,
        where("vehicle_id", "==", vehicleId),
        where("type", "==", "Xăng"),
        where("km_per_liter", ">", 0),
        orderBy("km_per_liter"), 
        orderBy("created_at", "asc") 
    );

    try {
        const snapshot = await getDocs(q);
        
        let chartData = [];
        snapshot.forEach(doc => {
            const data = doc.data();
            if(data.created_at) {
                chartData.push({
                    date: data.created_at.toDate().toLocaleDateString('vi-VN'),
                    kmpl: data.km_per_liter,
                    timestamp: data.created_at.toMillis()
                });
            }
        });
        
        // Sắp xếp lại theo thời gian
        chartData.sort((a, b) => a.timestamp - b.timestamp);

        const labels = chartData.map(item => item.date);
        const dataPoints = chartData.map(item => item.kmpl.toFixed(2));

        renderChart(labels, dataPoints, vehicleId);
    } catch (e) {
        console.log("Chờ Index Firebase cho biểu đồ...", e);
    }
}

function renderChart(labels, dataPoints, vehicleId) {
    const ctx = document.getElementById('expenseChart').getContext('2d');
    
    if (chartInstance) {
        chartInstance.destroy();
    }

    chartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: `Hiệu suất Km/Lít (${vehicleId})`,
                data: dataPoints,
                borderColor: '#198754', // Màu xanh lá success
                backgroundColor: 'rgba(25, 135, 84, 0.2)',
                tension: 0.3,
                fill: true,
                pointRadius: 5,
                pointHoverRadius: 8
            }]
        },
        options: {
            responsive: true,
            scales: {
                y: {
                    beginAtZero: false,
                    title: { display: true, text: 'Km / Lít' }
                }
            }
        }
    });
}

// ==========================================
// 8. KHỞI CHẠY KHI MỞ TRANG
// ==========================================
document.getElementById('vehicleId').addEventListener('change', (e) => {
    loadChart(e.target.value);
    checkPredictions(e.target.value);
});

// Chạy lần đầu
const defaultVehicle = document.getElementById('vehicleId').value;
loadChart(defaultVehicle);
checkPredictions(defaultVehicle);
