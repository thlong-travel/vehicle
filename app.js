import { initializeApp } from "firebase/app";
import { getFirestore, collection, addDoc, serverTimestamp, query, where, orderBy, limit, getDocs } from "firebase/firestore";

// ==========================================
// 1. CẤU HÌNH FIREBASE (Anh nhớ thay bằng Config của anh)
// ==========================================
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
// 3. LOGIC TRUY VẤN DỮ LIỆU CUỐI CÙNG
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
        console.error("Lỗi Query (Có thể thiếu Index Firebase):", e);
    }
    return null;
}

// ==========================================
// 4. TIÊN ĐOÁN NGÀY HẾT XĂNG
// ==========================================
async function checkPredictions(vehicleId) {
    const alertBox = document.getElementById('predictionAlert');
    alertBox.classList.add('d-none'); // Ẩn mặc định

    const lastFuel = await getLastRecord(vehicleId, "Xăng");
    
    if (lastFuel && lastFuel.days_cycle > 0 && lastFuel.created_at) {
        const lastDate = lastFuel.created_at.toDate();
        const now = new Date();
        const daysPassed = (now - lastDate) / (1000 * 3600 * 24);
        
        if (daysPassed >= (lastFuel.days_cycle - 1)) {
            alertBox.classList.remove('d-none');
            alertBox.innerHTML = `🚨 <strong>Gợi ý:</strong> Theo thói quen, có thể ngày mai xe <strong>${vehicleId}</strong> sẽ cần đổ xăng đấy!`;
        }
    }
}

// ==========================================
// 5. XỬ LÝ LƯU DỮ LIỆU VÀ SO SÁNH
// ==========================================
document.getElementById('btnSave').addEventListener('click', async () => {
    const btn = document.getElementById('btnSave');
    const vehicleId = document.getElementById('vehicleId').value;
    const type = document.getElementById('expenseType').value;
    const amount = Number(document.getElementById('amount').value);
    const volume = Number(document.getElementById('volume').value);
    const currentOdo = Number(document.getElementById('odometerValue').value);

    // Bắt lỗi Validation chặt chẽ
    if (!amount || !currentOdo) {
        alert("Vui lòng nhập đủ Số tiền và Số Odometer!");
        return;
    }
    if (type === "Xăng" && (!volume || volume <= 0)) {
        alert("Anh cần nhập số lít xăng lớn hơn 0 để hệ thống có thể tính toán hao phí!");
        return;
    }

    btn.disabled = true;
    btn.innerText = "⏳ Đang xử lý...";

    let kmPerLiter = 0;
    let daysCycle = 0;
    let alertMessage = "✅ Đã lưu dữ liệu thành công!";
    const now = new Date();

    try {
        // Logic cho XĂNG
        if (type === "Xăng") {
            const lastFuel = await getLastRecord(vehicleId, "Xăng");
            
            if (lastFuel && lastFuel.odometer && lastFuel.volume) {
                const distance = currentOdo - lastFuel.odometer;
                
                if (lastFuel.created_at) {
                    const lastDate = lastFuel.created_at.toDate();
                    daysCycle = (now - lastDate) / (1000 * 3600 * 24); 
                }
                
                if (distance > 0) {
                    // Tránh lỗi chia cho 0
                    const validVolume = lastFuel.volume > 0 ? lastFuel.volume : 1;
                    kmPerLiter = distance / validVolume; 
                    
                    if (lastFuel.km_per_liter) {
                        if (kmPerLiter < lastFuel.km_per_liter * 0.9) {
                            alertMessage = `⚠️ HAO XĂNG HƠN TRƯỚC!\nĐợt này chỉ đạt ${kmPerLiter.toFixed(2)} km/lít (Cũ: ${lastFuel.km_per_liter.toFixed(2)} km/lít).`;
                        } else {
                            alertMessage = `✅ Mức tiêu thụ ổn định: ${kmPerLiter.toFixed(2)} km/lít.`;
                        }
                    } else {
                        alertMessage = `✅ Đã ghi nhận mốc tiêu thụ đầu tiên: ${kmPerLiter.toFixed(2)} km/lít.`;
                    }
                } else {
                     alertMessage = "Lưu thành công. (Odometer không tăng so với lần trước).";
                }
            } else {
                alertMessage = "Lưu thành công mốc Xăng đầu tiên. Lần đổ sau hệ thống sẽ bắt đầu tính toán.";
            }
        }

        // Logic kiểm tra NHỚT
        const lastOil = await getLastRecord(vehicleId, "Nhớt máy");
        if (lastOil && currentOdo) {
            if (currentOdo - lastOil.odometer >= 3500) {
                alertMessage += `\n\n🚨 CẢNH BÁO NHỚT: Đã chạy ${currentOdo - lastOil.odometer} km kể từ lần thay cuối. Khuyến nghị thay nhớt!`;
            }
        }

        const dataToSave = {
            vehicle_id: vehicleId,
            type: type,
            amount: amount,
            volume: volume || 0,
            odometer: currentOdo,
            km_per_liter: kmPerLiter, 
            days_cycle: daysCycle,    
            created_at: serverTimestamp()
        };

        // Bắt đầu lưu lên Firebase
        await addDoc(collection(db, "expenses"), dataToSave);
        alert(alertMessage);
        
        // Reset form
        document.getElementById('amount').value = '';
        if(type === "Xăng") document.getElementById('volume').value = '';
        document.getElementById('odometerValue').value = '';
        
        // Refresh giao diện
        loadChart(vehicleId);
        setTimeout(() => checkPredictions(vehicleId), 1000); 

    } catch (error) {
        console.error("Lỗi khi lưu dữ liệu:", error);
        alert("Có lỗi xảy ra khi lưu! Anh kiểm tra lại F12 nhé.");
    } finally {
        // Đảm bảo nút Lưu luôn được giải phóng
        btn.disabled = false;
        btn.innerText = "💾 LƯU DỮ LIỆU";
    }
});

// ==========================================
// 6. VẼ BIỂU ĐỒ (CHART.JS)
// ==========================================
async function loadChart(vehicleId) {
    const expensesRef = collection(db, "expenses");
    // Query đơn giản để tránh lỗi Index phức tạp
    const q = query(
        expensesRef,
        where("vehicle_id", "==", vehicleId),
        where("type", "==", "Xăng"),
        orderBy("created_at", "asc") 
    );

    try {
        const snapshot = await getDocs(q);
        let chartData = [];
        snapshot.forEach(doc => {
            const data = doc.data();
            // Chỉ đưa vào biểu đồ nếu là số dương (bỏ qua mốc 0 đầu tiên)
            if(data.created_at && data.km_per_liter > 0) {
                chartData.push({
                    date: data.created_at.toDate().toLocaleDateString('vi-VN'),
                    kmpl: data.km_per_liter
                });
            }
        });

        const labels = chartData.map(item => item.date);
        const dataPoints = chartData.map(item => item.kmpl.toFixed(2));

        renderChart(labels, dataPoints, vehicleId);
    } catch (e) {
        console.error("Lỗi tải biểu đồ:", e);
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
                borderColor: '#198754',
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
// 7. KHỞI CHẠY KHI MỞ TRANG
// ==========================================
document.getElementById('vehicleId').addEventListener('change', (e) => {
    loadChart(e.target.value);
    checkPredictions(e.target.value);
});

const defaultVehicle = document.getElementById('vehicleId').value;
loadChart(defaultVehicle);
checkPredictions(defaultVehicle);
